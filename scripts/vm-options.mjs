export const machine = {
  memory_size: 128 * 1024 * 1024,
  vga_memory_size: 1024 * 1024,
  uart1: true,
  disable_keyboard: true,
  disable_mouse: true,
  disable_speaker: true,
  autostart: true,
};
export const cmdline = 'console=ttyS0,115200 quiet loglevel=3 rdinit=/init panic=-1 tsc=reliable';
