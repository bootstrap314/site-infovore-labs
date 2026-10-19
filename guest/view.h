/* A standalone pager executed by ash on its PTY, independent of site navigation. */
static volatile sig_atomic_t view_resume, view_quit;
static void view_signal(int signal_number) {
    if(signal_number==SIGCONT)view_resume=1;
    else view_quit=signal_number;
}
static int view_settings(void) {
    FILE *file=fopen("/run/site-terminal","r");
    if(!file)return 0;
    int theme;double width,height;
    int valid=fscanf(file,"%d %lf %lf",&theme,&width,&height)==3;
    fclose(file);
    if(!valid || theme<1 || theme>5 || width<=0 || height<=0)return 0;
    int changed=theme_resolved!=theme || cell_width!=width || cell_height!=height;
    theme_resolved=theme;cell_width=width;cell_height=height;
    return changed;
}
static void view_draw(void) {
    int x=2,width=COLS-4;
    erase();clearok(stdscr,TRUE);
    text(0,x,reader_notes[open_note].filename,3);
    text(2,x,reader_notes[open_note].title,2);
    layout_note(width,LINES-6);
    int begin=reader_page*body_height;
    for(int i=0;i<body_height && begin+i<row_count;i++) {
        ReadRow *row=&read_rows[begin+i];
        if(row->text)wide_text(4+i,x+row->offset,row->text,width-row->offset,row->pair,reader_pan);
    }
    text(LINES-2,x,COLS<66 ? "↑/↓ pages · d diagrams · q quit" : "↑/↓ or PgUp/PgDn pages · h/l pan · d diagrams · q / Esc returns to shell",3);
    char footer[80];snprintf(footer,sizeof(footer),"[ Prev ] [ Next ] [ Quit ]  %d/%d%s",reader_page+1,reader_pages,note_has_diagrams() ? (reader->ascii ? " ASCII" : " Images") : "");
    text(LINES-1,x,footer,2);
    refresh();
    for(int i=0;i<body_height && begin+i<row_count;i++)if(read_rows[begin+i].image)image_output(&read_rows[begin+i],4+i,x);
}
/* /bin/view is a link to /init, but this entry point never starts the site UI. */
static int shell_view(int argc,char **argv) {
    if(argc!=2) {fprintf(stderr,"Usage: view <post.md> (in /notes or /projects; Tab completes filenames)\n");return 1;}
    char path[PATH_MAX],candidate[PATH_MAX];
    if(!realpath(argv[1],path)) {
        snprintf(candidate,sizeof(candidate),"%s.md",argv[1]);
        if(!realpath(candidate,path)) {fprintf(stderr,"view: %s: no such post\n",argv[1]);return 1;}
    }
    int index=-1;
    for(int collection=0;collection<2 && index<0;collection++) {
        reader_select(collection);
        for(int i=0;i<reader_note_count;i++) {
            snprintf(candidate,sizeof(candidate),"/%s/%s",collection ? "projects" : "notes",reader_notes[i].filename);
            if(!strcmp(path,candidate)) {index=i;break;}
        }
    }
    if(index<0) {fprintf(stderr,"view: choose a published file in /notes or /projects\n");return 1;}
    if(!isatty(STDIN_FILENO) || !isatty(STDOUT_FILENO)) {
        for(int i=0;i<reader_notes[index].count;i++)puts(reader_notes[index].blocks[i].text);
        return 0;
    }
    setlocale(LC_ALL,"C.UTF-8");
    setenv("ESCDELAY","25",1);
    selected_note=index;note_open();view_settings();
    initscr();raw();noecho();keypad(stdscr,TRUE);curs_set(0);timeout(100);
    start_color();use_default_colors();
    init_pair(1,7,-1);init_pair(2,2,-1);init_pair(3,8,-1);
    init_pair(4,10,-1);init_pair(5,0,2);init_pair(6,3,-1);
    mousemask(BUTTON1_PRESSED|BUTTON4_PRESSED|BUTTON5_PRESSED,NULL);
    signal(SIGCONT,view_signal);signal(SIGTERM,view_signal);
    signal(SIGHUP,view_signal);signal(SIGINT,view_signal);
    int changed=1;
    while(!view_quit) {
        changed |= view_settings();
        if(view_resume) {view_resume=0;endwin();changed=1;}
        if(changed) {view_draw();changed=0;}
        int ch=getch();
        if(ch=='q' || ch=='Q' || ch==27 || ch==3)break;
        switch(ch) {
            case KEY_DOWN:case KEY_NPAGE:case 'j':case ' ':case '\n':note_move(1);changed=1;break;
            case KEY_UP:case KEY_PPAGE:case 'k':case 'b':note_move(-1);changed=1;break;
            case KEY_HOME:case 'g':reader_page=0;changed=1;break;
            case KEY_END:case 'G':reader_page=reader_pages-1;changed=1;break;
            case KEY_LEFT:case 'h':reader_pan-=8;if(reader_pan<0)reader_pan=0;changed=1;break;
            case KEY_RIGHT:case 'l':reader_pan+=8;changed=1;break;
            case 'd':note_toggle_diagrams();changed=1;break;
            case KEY_RESIZE:case 12:changed=1;break;
            case KEY_MOUSE: {
                MEVENT event;if(getmouse(&event)!=OK)break;
                if(event.bstate&BUTTON4_PRESSED) {note_move(-1);changed=1;}
                if(event.bstate&BUTTON5_PRESSED) {note_move(1);changed=1;}
                if((event.bstate&BUTTON1_PRESSED) && event.y==LINES-1) {
                    int col=event.x-2;
                    if(col>=0 && col<8) {note_move(-1);changed=1;}
                    else if(col>=9 && col<17) {note_move(1);changed=1;}
                    else if(col>=18 && col<26)view_quit=1;
                }
                break;
            }
        }
    }
    endwin();
    return view_quit>1 ? 128+view_quit : 0;
}
