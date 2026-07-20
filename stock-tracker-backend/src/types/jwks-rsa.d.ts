declare module 'jwks-rsa' {
  import type { JwtHeader } from 'jsonwebtoken';

  export interface SigningKey {
    getPublicKey(): string;
  }

  export interface JwksClientOptions {
    jwksUri: string;
    cache?: boolean;
    rateLimit?: boolean;
    jwksRequestsPerMinute?: number;
  }

  export interface JwksClient {
    getSigningKey(kid: string, callback: (error: Error | null, key?: SigningKey) => void): void;
    getSigningKey(header: JwtHeader, callback: (error: Error | null, key?: SigningKey) => void): void;
  }

  export default function jwksClient(options: JwksClientOptions): JwksClient;
}
