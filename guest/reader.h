/* The content is compiled on the host; this reader only lays out terminal cells. */
#include <wchar.h>
#include <locale.h>
#include <math.h>
#include "../.build/notes.h"
#include "../.build/projects.h"

typedef struct { wchar_t *text; int pair; const NoteBlock *image; int image_cols, image_rows, offset, block; } ReadRow;
static ReadRow *read_rows;
static int row_count, row_capacity, body_height, layout_block;
typedef struct { int selected, opened, top, position, pages, pan, ascii, anchor; } ReaderState;
static ReaderState reader_states[2]={{.opened=-1,.pages=1,.anchor=-1,.ascii=1},{.opened=-1,.pages=1,.anchor=-1,.ascii=1}};
static ReaderState *reader=&reader_states[0];
static const Note *reader_notes=notes;
static int reader_note_count;
#define selected_note (reader->selected)
#define open_note (reader->opened)
#define index_top (reader->top)
#define reader_page (reader->position)
#define reader_pages (reader->pages)
#define reader_pan (reader->pan)
static void reader_select(int collection) {
    reader=&reader_states[collection];
    reader_notes=collection ? projects : notes;
    reader_note_count=collection ? project_count : note_count;
}
static double cell_width = 8.4, cell_height = 17.1;
static int theme_choice, theme_resolved = 1, theme_picker, theme_cursor, theme_request = -1;
static const char *theme_names[] = {"Automatic (OS)", "Solarized Dark", "Solarized Light", "Nord", "Dracula", "Gruvbox"};

static void wide_text(int y, int x, const wchar_t *s, int width, int pair, int skip) {
    if (y < 0 || y >= LINES || x < 0 || x >= COLS) return;
    int at = 0;
    while (*s && at < skip) { int w = wcwidth(*s++); if (w > 0) at += w; }
    if (at > skip) { x += at - skip; width -= at - skip; }
    int n = 0, columns = 0;
    while (s[n]) {
        int w = wcwidth(s[n]); if (w < 0) w = 1;
        if (columns + w > width || x + columns + w >= COLS) break;
        columns += w; n++;
    }
    attrset(COLOR_PAIR(pair));
    mvaddnwstr(y,x,s,n);
}

static wchar_t *to_wide(const char *s) {
    size_t size = strlen(s) + 1;
    wchar_t *result = calloc(size,sizeof(wchar_t));
    if (!result) return NULL;
    if (mbstowcs(result,s,size) == (size_t)-1) {
        for (size_t i = 0; i < size; i++) result[i] = (unsigned char)s[i] < 128 ? s[i] : L'?';
    }
    return result;
}

static void add_row(const wchar_t *s, size_t length, int pair, const NoteBlock *image, int cols, int rows) {
    if (row_count == row_capacity) {
        int capacity = row_capacity ? row_capacity * 2 : 256;
        ReadRow *more = realloc(read_rows,(size_t)capacity*sizeof(ReadRow));
        if (!more) return;
        read_rows = more; row_capacity=capacity;
    }
    ReadRow *row = &read_rows[row_count++];
    *row = (ReadRow){.pair=pair,.image=image,.image_cols=cols,.image_rows=rows,.block=layout_block};
    if (s) {
        row->text = calloc(length+1,sizeof(wchar_t));
        if (row->text) wmemcpy(row->text,s,length);
    }
}

static void layout_note(int width, int height) {
    for (int i=0;i<row_count;i++) free(read_rows[i].text);
    row_count=0; body_height=height;
    if (open_note < 0 || open_note >= reader_note_count) return;
    const Note *note = &reader_notes[open_note];
    for (int b=0;b<note->count;b++) {
        const NoteBlock *block = &note->blocks[b];
        layout_block=b;
        int ascii=block->diagram && reader->ascii && *block->ascii;
        if (block->kind == 4 && !ascii) {
            double scale = fmin(1.0,fmin((width-2)*cell_width/block->width,(height-1)*cell_height/block->height));
            int cols = (int)floor(block->width*scale/cell_width);
            if (cols<1) cols=1;
            int rows = (int)ceil(block->height*(cols*cell_width/block->width)/cell_height);
            if (rows > height) rows=height;
            if (row_count % height + rows > height) {
                while (row_count % height) add_row(NULL,0,1,NULL,0,0);
            }
            add_row(NULL,0,1,block,cols,rows);
            if(block->diagram)read_rows[row_count-1].offset=(width-cols)/2;
            for (int i=1;i<rows;i++) add_row(NULL,0,1,NULL,0,0);
        } else if (block->kind == 5) {
            wchar_t rule[241]; int n=width < 240 ? width : 240;
            for (int i=0;i<n;i++) rule[i]=L'─';
            add_row(rule,(size_t)n,4,NULL,0,0);
        } else {
            wchar_t *wide = to_wide(ascii ? block->ascii : block->text);
            if (!wide) continue;
            const wchar_t *s=wide;
            int pair = block->kind == 1 ? 2 : block->kind == 3 ? 6 : 1;
            int pre = ascii || block->kind == 2 || block->kind == 3;
            int offset=0;
            if(ascii) {
                int widest=0,cells=0;
                for(const wchar_t *p=wide;;p++) {
                    if(*p==L'\n' || !*p) {if(cells>widest)widest=cells;cells=0;if(!*p)break;}
                    else {int w=wcwidth(*p);cells+=w>0 ? w : 0;}
                }
                if(widest<width)offset=(width-widest)/2;
            }
            if (pre) {
                int lines=1;
                for (const wchar_t *p=wide;*p;p++) if (*p==L'\n') lines++;
                if (lines<=height && row_count%height+lines>height) while(row_count%height) add_row(NULL,0,1,NULL,0,0);
            }
            while (*s) {
                size_t length=wcscspn(s,L"\n"), used=0;
                if (!length) add_row(L"",0,pair,NULL,0,0);
                while (used < length) {
                    size_t n=0, space=0; int cells=0;
                    while (used+n < length) {
                        int w=wcwidth(s[used+n]); if (w<0) w=1;
                        if (!pre && cells+w > width) break;
                        if (s[used+n]==L' ') space=n;
                        cells+=w; n++;
                    }
                    if (!n) n=1;
                    if (!pre && used+n < length && space) n=space;
                    add_row(s+used,n,pair,NULL,0,0); read_rows[row_count-1].offset=offset; used+=n;
                    if (!pre) while (used<length && s[used]==L' ') used++;
                }
                s+=length; if (*s==L'\n') s++;
            }
            free(wide);
        }
        add_row(NULL,0,1,NULL,0,0);
    }
    reader_pages = row_count ? (row_count+height-1)/height : 1;
    if(reader->anchor>=0) {
        for(int i=0;i<row_count;i++)if(read_rows[i].block==reader->anchor && (read_rows[i].text || read_rows[i].image)) {reader_page=i/height;break;}
        reader->anchor=-1;
    }
    if (reader_page >= reader_pages) reader_page=reader_pages-1;
    if (reader_page<0) reader_page=0;
}

static int note_has_diagrams(void) {
    if(open_note<0 || open_note>=reader_note_count)return 0;
    const Note *note=&reader_notes[open_note];
    for(int b=0;b<note->count;b++)if(*note->blocks[b].ascii)return 1;
    return 0;
}
static void note_toggle_diagrams(void) {
    if(!note_has_diagrams())return;
    // Anchor the current diagram across the different image/text pagination.
    int begin=reader_page*body_height;
    reader->anchor=-1;
    for(int i=begin;i<begin+body_height && i<row_count;i++) {
        ReadRow *row=&read_rows[i];
        if(!row->text && !row->image)continue;
        if(reader->anchor<0)reader->anchor=row->block;
        if(*reader_notes[open_note].blocks[row->block].ascii) {reader->anchor=row->block;break;}
    }
    reader->ascii=!reader->ascii;reader_pan=0;
}

static void note_open(void) { if (reader_note_count) {open_note=selected_note; reader_page=0; reader_pan=0; reader->anchor=-1;} }
static void note_move(int direction) {
    if (open_note>=0) { reader_page+=direction; if (reader_page<0) reader_page=0; if (reader_page>=reader_pages) reader_page=reader_pages-1; }
    else { selected_note+=direction; if (selected_note<0) selected_note=0; if (selected_note>=reader_note_count) selected_note=reader_note_count ? reader_note_count-1 : 0; }
}

static void image_output(const ReadRow *row, int y, int x) {
    x+=row->offset;
    const char *path = theme_resolved == 2 ? row->image->light_image : row->image->image;
    FILE *file=fopen(path,"rb");
    if (!file) return;
    if(fseek(file,0,SEEK_END)) {fclose(file);return;}
    long size=ftell(file);
    rewind(file);
    /* iTerm inline images are interpreted by xterm's image addon. ncurses
     * owns their placement; save/restore keeps its cursor model intact. */
    printf("\0337");
    /* Native screenshots can retain window transparency. Supply the requested
     * appearance behind their pixels without changing the source PNG. */
    if(row->image->backdrop) {
        int color=row->image->backdrop==1 ? 255 : 32;
        printf("\033[48;2;%d;%d;%dm",color,color,color);
        for(int i=0;i<row->image_rows;i++)printf("\033[%d;%dH%*s",y+i+1,x+1,row->image_cols,"");
        printf("\033[0m");
    }
    printf("\033[%d;%dH\033]1337;File=inline=1;size=%ld;width=%d;height=%d;preserveAspectRatio=1:",y+1,x+1,size,row->image_cols,row->image_rows);
    static const char alphabet[]="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    unsigned char bytes[3]; size_t n;
    while ((n=fread(bytes,1,3,file))) {
        unsigned int value=(unsigned int)bytes[0]<<16 | (n>1 ? (unsigned int)bytes[1]<<8 : 0) | (n>2 ? bytes[2] : 0);
        putchar(alphabet[(value>>18)&63]); putchar(alphabet[(value>>12)&63]);
        putchar(n>1 ? alphabet[(value>>6)&63] : '='); putchar(n>2 ? alphabet[value&63] : '=');
    }
    fclose(file); printf("\a\0338"); fflush(stdout);
}
