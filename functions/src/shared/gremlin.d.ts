declare module 'gremlin' {
  export namespace driver {
    class Client {
      constructor(url: string, options: Record<string, unknown>);
      open(): Promise<void>;
      submit(script: string, bindings?: Record<string, unknown>): Promise<ResultSet>;
      close(): Promise<void>;
    }

    namespace auth {
      class PlainTextSaslAuthenticator {
        constructor(username: string, password: string);
      }
    }
  }

  interface ResultSet {
    first(): unknown;
    toArray(): unknown[];
  }
}
