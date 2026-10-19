/* BusyBox ash owns a real PTY. PID 1 switches between that PTY and ncurses. */
#include <signal.h>
#include <sys/wait.h>
#include <poll.h>
#include <errno.h>
#include <limits.h>

static pid_t shell_pid, shell_foreground;
static int shell_master=-1;
static int shell_visible;
static char shell_pending[8192];
static size_t shell_pending_size;

#include "view.h"

static void shell_settings(void) {
    FILE *file=fopen("/run/site-terminal","w");
    if(file) {fprintf(file,"%d %.3f %.3f\n",theme_resolved,cell_width,cell_height);fclose(file);}
}
static int shell_start(void) {
    shell_settings();
    shell_master=posix_openpt(O_RDWR|O_NOCTTY);
    if(shell_master<0)return 0;
    if(grantpt(shell_master) || unlockpt(shell_master))goto fail;
    const char *name=ptsname(shell_master);if(!name)goto fail;
    char slave[128];snprintf(slave,sizeof(slave),"%s",name);
    struct winsize ws={.ws_row=LINES,.ws_col=COLS};
    ioctl(shell_master,TIOCSWINSZ,&ws);
    /* Send /dev/console output through the same line discipline and ordered
     * queue as ash output and command echo. Keep this redirect while hidden;
     * closing the PTY master releases it when the shell exits or setup fails. */
    int console=open(slave,O_WRONLY|O_NOCTTY|O_CLOEXEC);
    if(console<0)goto fail;
    int redirected=ioctl(console,TIOCCONS,0);
    close(console);
    if(redirected<0)goto fail;
    shell_pid=fork();
    if(shell_pid==0) {
        close(shell_master);
        if(control>=0)close(control);
        if(setsid()<0)_exit(127);
        int tty=open(slave,O_RDWR);
        if(tty<0)_exit(127);
        ioctl(tty,TIOCSCTTY,0);
        dup2(tty,STDIN_FILENO);dup2(tty,STDOUT_FILENO);dup2(tty,STDERR_FILENO);
        if(tty>2)close(tty);
        setenv("PATH","/bin",1);setenv("HOME","/root",1);
        chdir("/notes");
        execl("/bin/ash","ash","-l",(char *)NULL);
        _exit(127);
    }
    if(shell_pid<0) {shell_pid=0;goto fail;}
    fcntl(shell_master,F_SETFL,O_NONBLOCK);
    return 1;
fail:
    close(shell_master);shell_master=-1;return 0;
}
static void shell_hide(void) {
    if(!shell_visible)return;
    shell_foreground=tcgetpgrp(shell_master);
    /* Stop ash before its job, so it cannot reclaim the foreground PTY
     * in response to a stopped-child notification. Resume in reverse order. */
    if(shell_pid>0 && !kill(-shell_pid,SIGSTOP)) {
        siginfo_t info;
        while(waitid(P_PID,shell_pid,&info,WSTOPPED|WNOWAIT)<0 && errno==EINTR) {}
    }
    if(shell_foreground>0 && shell_foreground!=shell_pid)kill(-shell_foreground,SIGSTOP);
    shell_visible=0;
    reset_prog_mode();raw();noecho();keypad(stdscr,TRUE);timeout(0);
    mousemask(BUTTON1_PRESSED|BUTTON4_PRESSED|BUTTON5_PRESSED,NULL);
    clearok(stdscr,TRUE);
}
static int shell_show(void) {
    if(shell_visible)return 1;
    if(!shell_pid && !shell_start())return 0;
    struct termios serial;
    tcgetattr(STDIN_FILENO,&serial);cfmakeraw(&serial);
    def_prog_mode();endwin();fflush(stdout);
    tcsetattr(STDIN_FILENO,TCSANOW,&serial);
    shell_visible=1;
    if(shell_foreground>0 && shell_foreground!=shell_pid)kill(-shell_foreground,SIGCONT);
    kill(-shell_pid,SIGCONT);
    /* endwin restores the shell buffer but moves its cursor. Ask the line
     * editor to redraw its prompt and unfinished command at the current size. */
    if(shell_foreground==shell_pid)kill(-shell_pid,SIGWINCH);
    return 1;
}
static void shell_resize(int rows,int cols) {
    if(shell_master>=0) {struct winsize ws={.ws_row=rows,.ws_col=cols};ioctl(shell_master,TIOCSWINSZ,&ws);}
}
static int shell_poll(void) {
    int status;pid_t child;
    while((child=waitpid(-1,&status,WNOHANG))>0) {
        if(child==shell_pid) {
            shell_hide();shell_pid=0;shell_foreground=0;
            close(shell_master);shell_master=-1;
            shell_pending_size=0;
            if(page==PAGE_SHELL)page=0;
            return 1;
        }
    }
    return 0;
}
static void shell_io(void) {
    char bytes[4096];ssize_t n;
    /* Bound each drain so output-heavy commands cannot starve page controls. */
    for(int i=0;i<8 && (n=read(shell_master,bytes,sizeof(bytes)))>0;i++)fwrite(bytes,1,n,stdout);
    fflush(stdout);
    struct pollfd input={.fd=STDIN_FILENO,.events=POLLIN};
    if(shell_pending_size<sizeof(shell_pending) && poll(&input,1,0)>0 && (input.revents&POLLIN)) {
        n=read(STDIN_FILENO,shell_pending+shell_pending_size,sizeof(shell_pending)-shell_pending_size);
        if(n>0)shell_pending_size+=n;
    }
    if(shell_pending_size) {
        n=write(shell_master,shell_pending,shell_pending_size);
        if(n>0) {shell_pending_size-=n;memmove(shell_pending,shell_pending+n,shell_pending_size);}
        else usleep(20000);
    }
}
