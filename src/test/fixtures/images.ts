export const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY1kAAAAASUVORK5CYII=';
export const tinyPngBytes = () => Uint8Array.from(atob(tinyPngBase64), char => char.charCodeAt(0));
