declare module 'gremlin' {
  namespace driver {
    namespace auth {
      class Authenticator {}
      class PlainTextSaslAuthenticator extends Authenticator {
        constructor(username: string, password: string);
      }
    }

    class Client {
      constructor(
        url: string,
        options?: {
          authenticator?: auth.Authenticator;
          traversalsource?: string;
          rejectUnauthorized?: boolean;
          mimeType?: string;
        },
      );
      open(): Promise<void>;
      close(): Promise<void>;
      submit(
        message: string,
        bindings?: Record<string, unknown>,
      ): Promise<ResultSet>;
    }

    class ResultSet {
      toArray(): unknown[];
      first(): unknown;
      readonly length: number;
    }
  }

  namespace process {
    const statics: Record<string, (...args: unknown[]) => unknown>;
  }

  namespace structure {
    class Graph {}
    class Edge {
      readonly id: unknown;
      readonly label: string;
      readonly inV: Vertex;
      readonly outV: Vertex;
      readonly properties: Record<string, unknown>;
    }
    class Vertex {
      readonly id: unknown;
      readonly label: string;
      readonly properties: Record<string, unknown[]>;
    }
  }

  export { driver, process, structure };
}
