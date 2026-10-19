export const themes = [
  {id:'auto',name:'Automatic (OS)'},
  {id:'solarized-dark',name:'Solarized Dark',bg:'#002b36',panel:'#073642',fg:'#839496',muted:'#657b83',border:'#586e75',accent:'#2aa198',red:'#dc322f',yellow:'#b58900',blue:'#268bd2',magenta:'#d33682',cyan:'#2aa198',strong:'#eee8d5'},
  {id:'solarized-light',name:'Solarized Light',bg:'#fdf6e3',panel:'#eee8d5',fg:'#586e75',muted:'#657b83',border:'#93a1a1',accent:'#268bd2',red:'#dc322f',yellow:'#b58900',blue:'#268bd2',magenta:'#d33682',cyan:'#2aa198',strong:'#073642'},
  {id:'nord',name:'Nord',bg:'#2e3440',panel:'#3b4252',fg:'#d8dee9',muted:'#a5b0c5',border:'#4c566a',accent:'#88c0d0',red:'#bf616a',yellow:'#ebcb8b',blue:'#81a1c1',magenta:'#b48ead',cyan:'#8fbcbb',strong:'#eceff4'},
  {id:'dracula',name:'Dracula',bg:'#282a36',panel:'#343746',fg:'#f8f8f2',muted:'#a1a9d3',border:'#6272a4',accent:'#bd93f9',red:'#ff5555',yellow:'#f1fa8c',blue:'#8be9fd',magenta:'#ff79c6',cyan:'#8be9fd',strong:'#ffffff'},
  {id:'gruvbox',name:'Gruvbox',bg:'#282828',panel:'#3c3836',fg:'#ebdbb2',muted:'#bdae93',border:'#665c54',accent:'#b8bb26',red:'#fb4934',yellow:'#fabd2f',blue:'#83a598',magenta:'#d3869b',cyan:'#8ec07c',strong:'#fbf1c7'},
];

export function terminalTheme(t) {
  return {background:t.bg,foreground:t.fg,cursor:t.accent,selectionBackground:t.border,
    black:t.bg,red:t.red,green:t.accent,yellow:t.yellow,blue:t.blue,magenta:t.magenta,cyan:t.cyan,white:t.fg,
    brightBlack:t.muted,brightRed:t.strong,brightGreen:t.border,brightYellow:t.yellow,brightBlue:t.blue,brightMagenta:t.magenta,brightCyan:t.cyan,brightWhite:t.strong};
}

export function themeCss() {
  const vars=t=>`--bg:${t.bg};--panel:${t.panel};--fg:${t.fg};--muted:${t.muted};--border:${t.border};--accent:${t.accent};--strong:${t.strong};color-scheme:${t.id==='solarized-light' ? 'light' : 'dark'};`;
  return `:root{${vars(themes[1])}}@media(prefers-color-scheme:light){:root:not([data-theme]){${vars(themes[2])}}}` + themes.slice(1).map(t=>`:root[data-theme="${t.id}"]{${vars(t)}}`).join('');
}
