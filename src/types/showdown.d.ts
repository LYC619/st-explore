declare module 'showdown' {
  export default class Showdown {
    static Converter: new (options?: Record<string, unknown>) => { makeHtml(text: string): string };
  }
}
