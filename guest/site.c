#define _DEFAULT_SOURCE
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

static int page, control = -1;
static int help;
static struct utsname system_name;
static const char *pages[] = {"Home", "About", "Work", "Notes", "System"};

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
    if (y < 0 || y >= LINES || x >= COLS) return;
    attrset(COLOR_PAIR(pair));
    mvaddnstr(y, x, s, COLS - x - 1);
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

static void identity(void) {
    if (control < 0) return;
    dprintf(control, "{\"event\":\"ready\",\"kernel\":\"%s\",\"machine\":\"%s\",\"ncurses\":\"%s\",\"pid\":%d,\"page\":%d,\"rows\":%d,\"cols\":%d}\n",
            system_name.release, system_name.machine, curses_version(), getpid(), page, LINES, COLS);
}

static void draw(void) {
    erase();
    int narrow = COLS < 66;
    int x = narrow ? 2 : 5;
    int width = COLS - x * 2;
    text(1, x, "PERSONAL / SPACE", 2);
    if (!narrow) text(1, COLS - 23, "LINUX  /  NCURSES", 3);
    attrset(COLOR_PAIR(4)); mvhline(3, x, ACS_HLINE, width);
    int nav = x;
    for (int i = 0; i < 5; i++) {
        char label[32];
        snprintf(label, sizeof(label), narrow ? "%d%s" : " %d %s ", i + 1, pages[i]);
        text(5, nav, label, i == page ? 5 : 3);
        nav += (int)strlen(label) + (narrow ? 1 : 2);
    }
    int y = 8;
    if (help) {
        text(y, x, "A small field guide.", 2);
        y = paragraph(y + 2, x, width, "Use the arrow keys, Tab, or 1-5 to move between pages. You can also click a page name or use the buttons below the terminal.", 1);
        paragraph(y + 2, x, width, "Press ? to close this guide. Press r to redraw. Everything inside this terminal is rendered by ncurses, running in your own browser's Linux guest.", 3);
    } else if (page == 0) {
        text(y, x, "Hello, visitor._", 2);
        y = paragraph(y + 2, x, width, "Welcome to my little corner of the internet.", 1);
        y = paragraph(y + 2, x, width, "A personal space for work, notes, and things worth sharing. The foundation is here. The stories come next.", 3);
        text(y + 2, x, "[ CONTENT TO COME ]", 6);
        if (LINES > 26) {
            text(LINES - 8, x, "One browser tab. One tiny Linux machine.", 1);
            text(LINES - 6, x, narrow ? "Press 5 to look inside." : "Explore with the arrow keys or press 5 to look inside.", 3);
        }
    } else if (page == 1) {
        text(y, x, "A little about me.", 2);
        y = paragraph(y + 2, x, width, "This page is ready for an introduction, a few interests, and a way to get in touch.", 1);
        paragraph(y + 2, x, width, "Personal content will be added after the foundation is approved.", 3);
    } else if (page == 2) {
        text(y, x, "Selected work.", 2);
        y = paragraph(y + 2, x, width, "A place for projects, experiments, and the details behind them.", 1);
        text(y + 2, x, "No projects published yet.", 3);
    } else if (page == 3) {
        text(y, x, "Notes from the terminal.", 2);
        y = paragraph(y + 2, x, width, "A quiet place for ideas in progress and things learned along the way.", 1);
        text(y + 2, x, "No notes published yet.", 3);
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
        if (LINES > 27) paragraph(y + 10, x, width, "The kernel, process, memory, and terminal all live in this tab. A saved machine state makes returning here quick. No remote server runs this session.", 3);
    }
    attrset(COLOR_PAIR(4)); mvhline(LINES - 4, x, ACS_HLINE, width);
    text(LINES - 2, x, narrow ? "1-5 pages  /  ? help" : "arrows / tab  navigate     1-5  jump     ?  help", 3);
    if (!narrow) text(LINES - 2, COLS - 14, "* online", 2);
    refresh();
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
        int rows, cols, target;
        if (sscanf(buffer, "R %d %d", &rows, &cols) == 2 && rows >= 22 && rows <= 100 && cols >= 38 && cols <= 240) {
            struct winsize ws = {.ws_row = rows, .ws_col = cols};
            ioctl(STDIN_FILENO, TIOCSWINSZ, &ws);
            resizeterm(rows, cols);
            clearok(stdscr, TRUE);
            changed = 1;
        } else if (sscanf(buffer, "P %d", &target) == 1 && target >= 0 && target < 5) {
            page = target; help = 0; changed = 1;
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

int main(void) {
    mount("proc", "/proc", "proc", 0, NULL);
    mount("sysfs", "/sys", "sysfs", 0, NULL);
    uname(&system_name);
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
    timeout(100);
    start_color(); use_default_colors();
    init_pair(1, 252, -1); init_pair(2, 192, -1); init_pair(3, 245, -1);
    init_pair(4, 238, -1); init_pair(5, 234, 192); init_pair(6, 180, -1);
    mousemask(BUTTON1_CLICKED | BUTTON1_PRESSED, NULL);
    draw(); identity();
    time_t last = time(NULL);
    for (;;) {
        int changed = control_input();
        int ch = getch();
        switch (ch) {
            case KEY_RIGHT: case KEY_DOWN: case '\t': case 'j': case 'l': page = (page + 1) % 5; help = 0; changed = 1; break;
            case KEY_LEFT: case KEY_UP: case KEY_BTAB: case 'k': case 'h': page = (page + 4) % 5; help = 0; changed = 1; break;
            case '1': case '2': case '3': case '4': case '5': page = ch - '1'; help = 0; changed = 1; break;
            case '?': help = !help; changed = 1; break;
            case 'r': case 12: case KEY_RESIZE: clearok(stdscr, TRUE); changed = 1; break;
            case KEY_MOUSE: {
                MEVENT event;
                if (getmouse(&event) == OK && event.y == 5) {
                    int narrow = COLS < 66, col = narrow ? 2 : 5;
                    for (int i = 0; i < 5; i++) {
                        int length = (int)strlen(pages[i]) + (narrow ? 1 : 4);
                        if (event.x >= col && event.x < col + length) { page = i; help = 0; changed = 1; }
                        col += length + (narrow ? 1 : 2);
                    }
                }
                break;
            }
        }
        time_t now = time(NULL);
        if (page == 4 && now != last) changed = 1;
        last = now;
        if (changed) { draw(); identity(); }
    }
}
