#define _DEFAULT_SOURCE
#define _XOPEN_SOURCE 700
#include <curses.h>
#include <sys/mount.h>
#include <sys/ioctl.h>
#include <sys/utsname.h>
#include <sys/sysinfo.h>
#include <fcntl.h>
#include <termios.h>
#include <unistd.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include "reader.h"
#include "../.build/resume.h"

static int page, control = -1;
static int help;
static int resume_request;
static struct utsname system_name;
enum { PAGE_HOME, PAGE_ABOUT, PAGE_WORK, PAGE_NOTES, PAGE_PROJECTS, PAGE_SYSTEM, PAGE_SHELL, PAGE_COUNT };
enum { NAV_ROW = 1, CONTENT_ROW = 4, READER_ROW = 7 };
static const char *pages[] = {"Home", "About", "Work", "Notes", "Projects", "System", "Shell"};
static const char *short_pages[] = {"Home", "Me", "Work", "Notes", "Proj", "Sys", "Shell"};
static const char *tiny_pages[] = {"Ho", "Me", "Wo", "No", "Pr", "Sy", "Sh"};
static int reader_page_active(void) {return page==PAGE_NOTES || page==PAGE_PROJECTS;}
static void nav_label(char *label,size_t size,int index) {
    const char *name=COLS<50 ? tiny_pages[index] : COLS<86 ? short_pages[index] : pages[index];
    snprintf(label,size,COLS<86 ? "%d%s" : " %d %s ",index+1,name);
}

/* Snapshot preparation only: zero free pages holding discarded boot data.
 * Touching one byte faults in a zeroed page; volatile prevents dead-store removal. */
static void scrub_free_pages(void) {
    struct sysinfo info;
    if (sysinfo(&info)) return;
    size_t free_bytes = (size_t)info.freeram * info.mem_unit;
    if (free_bytes < 16 * 1024 * 1024) return;
    size_t length = free_bytes - 8 * 1024 * 1024;
    volatile unsigned char *memory = malloc(length);
    if (!memory) return;
    for (size_t i = 0; i < length; i += 4096) memory[i] = 0;
    free((void *)memory);
}

static void text(int y, int x, const char *s, int pair) {
    wchar_t *wide = to_wide(s);
    if (wide) { wide_text(y,x,wide,COLS-x-1,pair,0); free(wide); }
}

static int paragraph(int y, int x, int width, const char *s, int pair) {
    char word[256];
    int col = 0;
    while (*s) {
        while (*s == ' ') s++;
        size_t n = strcspn(s, " \n");
        if (n >= sizeof(word)) n = sizeof(word) - 1;
        if (col && col + (int)n > width) { y++; col = 0; }
        memcpy(word, s, n); word[n] = 0;
        text(y, x + col, word, pair);
        col += (int)n + 1;
        s += n;
        if (*s == '\n') { y++; col = 0; s++; }
        if (y >= LINES - 5) break;
    }
    return y + 1;
}

#include "shell.h"
#include "ip.h"

static void close_note(void) {
    open_note=-1;
}

static void identity(void) {
    if (control < 0) return;
    dprintf(control, "{\"event\":\"ready\",\"kernel\":\"%s\",\"machine\":\"%s\",\"ncurses\":\"%s\",\"pid\":%d,\"page\":%d,\"rows\":%d,\"cols\":%d,\"note\":%d,\"selectedNote\":%d,\"noteCount\":%d,\"readerPage\":%d,\"readerPages\":%d,\"diagramAscii\":%d,\"hasDiagrams\":%d,\"themeChoice\":%d,\"themePicker\":%d,\"themeRequest\":%d,\"shellPid\":%d}\n",
            system_name.release, system_name.machine, curses_version(), getpid(), page, LINES, COLS,open_note,selected_note,reader_note_count,reader_page,reader_pages,reader->ascii,note_has_diagrams(),theme_choice,theme_picker,theme_request,(int)shell_pid);
    if(resume_request) {dprintf(control,"{\"resumeRequest\":true}\n");resume_request=0;}
    theme_request=-1;
}

static void draw(void) {
    if(reader_page_active())reader_select(page==PAGE_PROJECTS);
    erase(); clearok(stdscr,TRUE);
    curs_set(0);
    int narrow = COLS < 66;
    int x = narrow ? 2 : 5;
    int width = COLS - x * 2;
    int nav = x;
    for (int i = 0; i < PAGE_COUNT; i++) {
        char label[32];
        nav_label(label,sizeof(label),i);
        text(NAV_ROW, nav, label, i == page ? 5 : 3);
        nav += (int)strlen(label) + (COLS<86 ? 1 : 2);
    }
    int y = CONTENT_ROW;
    if (help) {
        text(y, x, "A small field guide.", 2);
        y = paragraph(y + 2, x, width, "Left/Right, Tab, or 1-7 changes sections. In Notes and Projects, Up/Down chooses a post and Enter opens it. Up/Down, PgUp/PgDn, or the wheel turns pages. Esc returns; h/l pans wide content; d switches diagrams between images and ASCII.", 1);
        paragraph(y + 1, x, width, "On Work, Enter opens the résumé. On System, t chooses a theme. Shell runs BusyBox ash with ? help and Tab completion. Press ? to close this guide.", 3);
    } else if (page == 0) {
        text(y, x, "Hello, visitor._", 2);
        y = paragraph(y + 2, x, width, "Welcome to my little corner of the internet.", 1);
        y = paragraph(y + 2, x, width, "A personal space for work, notes, and things worth sharing. The foundation is here. The stories come next.", 3);
        text(y + 2, x, "[ CONTENT TO COME ]", 6);
        if (LINES > 26) {
            text(LINES - 8, x, "One browser tab. One tiny Linux machine.", 1);
            text(LINES - 6, x, narrow ? "Press 6 to look inside." : "Explore with the arrow keys or press 6 to look inside.", 3);
        }
    } else if (page == 1) {
        text(y, x, "A little about me.", 2);
        y = paragraph(y + 2, x, width, "This page is ready for an introduction, a few interests, and a way to get in touch.", 1);
        paragraph(y + 2, x, width, "Personal content will be added after the foundation is approved.", 3);
    } else if (page == 2) {
        text(y, x, resume_name, 2);
        y = paragraph(y + 2, x, width, resume_title, 1);
        for(int i=0;i<resume_jobs && i<3 && y+3<LINES-7;i++) {
            y++;
            text(y++,x,resume_companies[i],1);
            text(y++,x,resume_dates[i],3);
        }
        if(y+1<LINES-7)text(y+1,x,resume_email,3);
        text(LINES-6,x,narrow ? "[ Read résumé ] Enter" : "[ Read full résumé ]  Enter to open",2);
    } else if (reader_page_active()) {
        char label[512];
        if (open_note < 0) {
            text(y,x,page==PAGE_PROJECTS ? "Projects from the terminal." : "Notes from the terminal.",2);
            if (!reader_note_count) text(y+2,x,page==PAGE_PROJECTS ? "No projects published yet." : "No notes published yet.",3);
            else {
                int visible=LINES-READER_ROW-4;
                if (selected_note<index_top) index_top=selected_note;
                if (selected_note>=index_top+visible) index_top=selected_note-visible+1;
                snprintf(label,sizeof(label),"%d posts · ↑/↓ choose · Enter read",reader_note_count); text(y+1,x,label,3);
                for (int i=index_top;i<reader_note_count && i<index_top+visible;i++) {
                    snprintf(label,sizeof(label),"%s %s%s%s",i==selected_note ? "›" : " ",reader_notes[i].date,*reader_notes[i].date ? "  " : "",reader_notes[i].title);
                    text(READER_ROW+i-index_top,x,label,i==selected_note ? 5 : 1);
                }
            }
        } else {
            text(y,x,reader_notes[open_note].title,2);
            layout_note(width,LINES-READER_ROW-4);
            snprintf(label,sizeof(label),"[ Back ]   [ Prev ]  [ Next ]   %d/%d",reader_page+1,reader_pages);
            text(y+1,x,label,3);
            int begin=reader_page*body_height;
            for (int i=0;i<body_height && begin+i<row_count;i++) {
                ReadRow *row=&read_rows[begin+i];
                read_row_output(row,READER_ROW+i,x,width);
            }
        }
    } else if (page==PAGE_SHELL) {
        /* BusyBox owns the terminal while Shell is selected. */
    } else if (theme_picker) {
        text(y,x,"Choose a theme.",2);
        for (int i=0;i<6;i++) {
            char line[80]; snprintf(line,sizeof(line),"%s %s%s",i==theme_cursor ? "›" : " ",theme_names[i],i==theme_choice ? " *" : "");
            text(y+2+i,x,line,i==theme_cursor ? 5 : 1);
        }
    } else {
        char line[256];
        struct sysinfo info;
        sysinfo(&info);
        text(y, x, "Yes, this is Linux.", 2);
        snprintf(line, sizeof(line), "Kernel     Linux %s", system_name.release); text(y + 2, x, line, 1);
        snprintf(line, sizeof(line), "Machine    %s / v86 / WebAssembly", system_name.machine); text(y + 3, x, line, 1);
        snprintf(line, sizeof(line), "Interface  %s", curses_version()); text(y + 4, x, line, 1);
        snprintf(line, sizeof(line), "Process    /init (PID %d)", getpid()); text(y + 5, x, line, 1);
        snprintf(line, sizeof(line), "Memory     %lu MiB available to Linux", (info.totalram * (unsigned long)info.mem_unit) / (1024 * 1024)); text(y + 6, x, line, 1);
        snprintf(line, sizeof(line), "Uptime     %ld seconds", info.uptime); text(y + 7, x, line, 1);
        snprintf(line,sizeof(line),"[ Theme: %s ]  t to change",theme_names[theme_choice]); text(LINES-6,x,line,2);
    }
    attrset(COLOR_PAIR(4)); mvhline(LINES - 4, x, ACS_HLINE, width);
    const char *hint = page==PAGE_SHELL ? (narrow ? "Tab complete / exit home" : "Tab complete · ↑/↓ history · exit home") : page==2 ? "Enter résumé · Tab sections" : reader_page_active() ? (open_note<0 ? "←/→ tabs · ↑/↓ choose · Enter read" : "↑/↓ pages · Esc back · d diagrams") : page==PAGE_SYSTEM && theme_picker ? "↑/↓ choose · Enter apply · Esc back" : narrow ? "1-7 pages  /  ? help" : "arrows / tab  navigate     1-7  jump     ?  help";
    text(LINES-2,x,hint,3);

    refresh();
    /* Restoring a snapshot redraws a fresh terminal after endwin(). Re-enable
     * application cursor keys before reporting readiness, rather than waiting
     * for getch() to do it after the visitor's first arrow key arrives. */
    keypad(stdscr,TRUE);
    if (!help && reader_page_active() && open_note>=0) {
        int begin=reader_page*body_height;
        for (int i=0;i<body_height && begin+i<row_count;i++) if (read_rows[begin+i].image) image_output(&read_rows[begin+i],READER_ROW+i,x);
    }
}

static int control_input(void) {
    static char buffer[128];
    static size_t used;
    char c;
    int changed = 0;
    while (control >= 0 && read(control, &c, 1) == 1) {
        if (c != '\n') {
            if (used < sizeof(buffer) - 1) buffer[used++] = c;
            else used = 0;
            continue;
        }
        buffer[used] = 0;
        int rows, cols, target, cell_w=0, cell_h=0, resolved;
        unsigned request;char address[64];
        if (sscanf(buffer, "R %d %d", &rows, &cols) == 2 && rows >= 22 && rows <= 100 && cols >= 38 && cols <= 240) {
            struct winsize ws = {.ws_row = rows, .ws_col = cols};
            ioctl(STDIN_FILENO, TIOCSWINSZ, &ws);
            resizeterm(rows, cols);
            shell_resize(rows,cols);
            if (sscanf(buffer,"R %d %d %d %d",&rows,&cols,&cell_w,&cell_h)==4 && cell_w>0 && cell_h>0) {cell_width=cell_w/1000.0;cell_height=cell_h/1000.0;}
            shell_settings();
            clearok(stdscr, TRUE);
            changed = 1;
        } else if (sscanf(buffer, "P %d", &target) == 1 && target >= 0 && target < PAGE_COUNT) {
            page = target; help = 0; theme_picker=0; changed = 1;
            if(reader_page_active())reader_select(page==PAGE_PROJECTS);
        } else if (sscanf(buffer,"T %d %d",&target,&resolved)==2 && target>=0 && target<6 && resolved>=1 && resolved<6) {
            theme_choice=target;theme_resolved=resolved;shell_settings();changed=1;
        } else if (reader_page_active() && !strcmp(buffer,"N open")) {note_open();changed=1;
        } else if (reader_page_active() && !strcmp(buffer,"N back")) {close_note();changed=1;
        } else if (reader_page_active() && !strcmp(buffer,"N next")) {note_move(1);changed=1;
        } else if (reader_page_active() && !strcmp(buffer,"N diagrams")) {note_toggle_diagrams();changed=1;
        } else if (reader_page_active() && !strcmp(buffer,"N prev")) {note_move(-1);changed=1;

        } else if (sscanf(buffer,"A %u %63s",&request,address)==2) {
            ip_response(request,address);
        } else if (!strcmp(buffer, "S")) {
            scrub_free_pages(); changed = 1;
        } else if (!strcmp(buffer, "I")) {
            /* The VM has resumed into a fresh browser terminal. Re-emit all
             * terminal modes (application keys, mouse tracking, hidden cursor). */
            endwin();
            clearok(stdscr, TRUE); changed = 1;
        }
        used = 0;
    }
    return changed;
}

int main(int argc,char **argv) {
    reader_select(0);
    const char *name=strrchr(argv[0],'/');name=name ? name+1 : argv[0];
    if(!strcmp(name,"view"))return shell_view(argc,argv);
    if(!strcmp(name,"ip"))return shell_ip(argc,argv);
    /* /dev/console can be redirected to the shell PTY. Keep PID 1's
     * ncurses display and PTY forwarding on the physical serial device so
     * forwarding a console write cannot feed it back into the same PTY. */
    int serial=open("/dev/ttyS0",O_RDWR|O_NOCTTY);
    if(serial<0) {perror("/dev/ttyS0");return 1;}
    for(int fd=0;fd<3;fd++)if(dup2(serial,fd)<0) {perror("dup2");return 1;}
    if(serial>2)close(serial);
    mount("proc", "/proc", "proc", 0, NULL);
    mount("sysfs", "/sys", "sysfs", 0, NULL);
    mount("devpts", "/dev/pts", "devpts", 0, NULL);
    sethostname("personal",8);
    ip_init();
    uname(&system_name);
    setlocale(LC_ALL,"C.UTF-8");
    setenv("TERM", "xterm-256color", 1);
    setenv("TERMINFO", "/usr/share/terminfo", 1);
    setenv("ESCDELAY", "25", 1);
    struct winsize ws = {.ws_row = 32, .ws_col = 96};
    ioctl(STDIN_FILENO, TIOCSWINSZ, &ws);
    control = open("/dev/ttyS1", O_RDWR | O_NOCTTY | O_NONBLOCK);
    struct termios term;
    if (control >= 0 && tcgetattr(control, &term) == 0) {
        cfmakeraw(&term); term.c_cflag |= CLOCAL | CREAD;
        tcsetattr(control, TCSANOW, &term);
    }
    initscr(); raw(); noecho(); keypad(stdscr, TRUE); curs_set(0);
    timeout(0);
    start_color(); use_default_colors();
    init_pair(1, 7, -1); init_pair(2, 2, -1); init_pair(3, 8, -1);
    init_pair(4, 10, -1); init_pair(5, 0, 2); init_pair(6, 3, -1);
    mousemask(BUTTON1_PRESSED | BUTTON4_PRESSED | BUTTON5_PRESSED, NULL);
    draw(); identity();
    time_t last = time(NULL);
    for (;;) {
        /* Both serial ports share the event loop. Process page controls before
         * consuming a key, so typing immediately after clicking Shell reaches
         * ash instead of a getch() still waiting on the previous page. */
        struct pollfd events[]={{.fd=control,.events=POLLIN},
                                {.fd=STDIN_FILENO,.events=POLLIN},
                                {.fd=shell_visible ? shell_master : -1,.events=POLLIN},
                                {.fd=ip_socket,.events=POLLIN}};
        poll(events,4,20);
        ip_requests();
        int changed = control_input();
        changed |= shell_poll();
        if(page==PAGE_SHELL) {
            if(shell_show()) {shell_io();if(changed)identity();continue;}
            page=0;changed=1;
        }
        if(shell_visible) {shell_hide();changed=1;}
        int ch = getch();
        if (!help && page==2 && (ch=='\n' || ch==KEY_ENTER)) {resume_request=1;changed=1;ch=ERR;}
        if (!help && reader_page_active()) {
            if (ch==KEY_DOWN || ch==KEY_NPAGE || ch=='j' || (ch==' ' && open_note>=0)) {note_move(1);changed=1;ch=ERR;}
            else if (ch==KEY_UP || ch==KEY_PPAGE || ch=='k') {note_move(-1);changed=1;ch=ERR;}
            else if (ch=='\n' || ch==KEY_ENTER) {note_open();changed=1;ch=ERR;}
            else if (ch==27 || ch==KEY_BACKSPACE || ch==127 || (open_note>=0 && ch=='b')) {close_note();changed=1;ch=ERR;}
            else if (open_note>=0 && ch=='d') {note_toggle_diagrams();changed=1;ch=ERR;}
            else if (open_note>=0 && (ch=='h' || ch=='l')) {reader_pan+=ch=='h' ? -8 : 8;if(reader_pan<0)reader_pan=0;changed=1;ch=ERR;}
            else if (ch==KEY_HOME || ch==KEY_END) {if(open_note>=0)reader_page=ch==KEY_HOME ? 0 : reader_pages-1;else selected_note=ch==KEY_HOME ? 0 : (reader_note_count ? reader_note_count-1 : 0);changed=1;ch=ERR;}
        }
        if (!help && page==PAGE_SYSTEM) {
            if (ch=='t') {theme_picker=!theme_picker;theme_cursor=theme_choice;changed=1;ch=ERR;}
            else if (theme_picker) {
                if (ch==KEY_DOWN || ch=='j' || ch==KEY_UP || ch=='k') {theme_cursor=(theme_cursor+((ch==KEY_DOWN||ch=='j') ? 1 : 5))%6;changed=1;ch=ERR;}
                else if (ch=='\n' || ch==KEY_ENTER) {theme_request=theme_cursor;changed=1;ch=ERR;}
                else if (ch==27) {theme_picker=0;changed=1;ch=ERR;}
            }
        }
        switch (ch) {
            case KEY_RIGHT: case KEY_DOWN: case '\t': case 'j': case 'l': page = (page + 1) % PAGE_COUNT; help = 0;theme_picker=0; changed = 1; break;
            case KEY_LEFT: case KEY_UP: case KEY_BTAB: case 'k': case 'h': page = (page + PAGE_COUNT-1) % PAGE_COUNT; help = 0;theme_picker=0; changed = 1; break;
            case '1': case '2': case '3': case '4': case '5': case '6': case '7': page = ch - '1'; help = 0;theme_picker=0; changed = 1; break;
            case '?': help = !help; changed = 1; break;
            case 'r': case 12: case KEY_RESIZE: clearok(stdscr, TRUE); changed = 1; break;
            case KEY_MOUSE: {
                MEVENT event;
                if (getmouse(&event) != OK) break;
                int clicked=(event.bstate & BUTTON1_PRESSED)!=0;
                if (clicked && event.y == NAV_ROW) {
                    int col = COLS < 66 ? 2 : 5;
                    for (int i = 0; i < PAGE_COUNT; i++) {
                        char label[32];nav_label(label,sizeof(label),i);
                        int length = (int)strlen(label);
                        if (event.x >= col && event.x < col + length) { page = i; help = 0; theme_picker=0; changed = 1; }
                        col += length + (COLS<86 ? 1 : 2);
                    }
                } else if (!help && reader_page_active()) {
                    if (event.bstate & BUTTON4_PRESSED) {note_move(-1);changed=1;}
                    if (event.bstate & BUTTON5_PRESSED) {note_move(1);changed=1;}
                    if (clicked && open_note<0 && event.y>=READER_ROW && event.y<LINES-4) {
                        int index=index_top+event.y-READER_ROW;
                        if(index<reader_note_count) {selected_note=index;note_open();changed=1;}
                    } else if (clicked && open_note>=0 && event.y==CONTENT_ROW+1) {
                        int col=event.x-(COLS<66 ? 2 : 5);
                        if(col>=0 && col<8)close_note();else if(col>=11 && col<19)note_move(-1);else if(col>=21 && col<29)note_move(1);
                        changed=1;
                    }
                } else if (!help && page==2 && clicked && event.y==LINES-6) {
                    resume_request=1;changed=1;
                } else if (!help && page==PAGE_SYSTEM && clicked) {
                    if(theme_picker && event.y>=CONTENT_ROW+2 && event.y<CONTENT_ROW+8) {theme_cursor=event.y-CONTENT_ROW-2;theme_request=theme_cursor;changed=1;}
                    else if(event.y==LINES-6) {theme_picker=1;theme_cursor=theme_choice;changed=1;}
                }
                break;
            }
        }
        time_t now = time(NULL);
        if (page==PAGE_SYSTEM && now != last) changed = 1;
        last = now;
        if (changed) {
            if(page==PAGE_SHELL) {if(!shell_show()) {page=0;draw();}} else draw();
            identity();
        }
    }
}
