import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt, { type JwtHeader, type JwtPayload } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import sql from 'mssql';
import { getPool } from './db/connection.js';

export interface AuthenticatedUser {
  id: string;
  email?: string | null;
  name?: string | null;
  pictureUrl?: string | null;
}

interface Auth0Claims extends JwtPayload {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

interface AuthConfig {
  domain?: string;
  audience?: string;
  issuer?: string;
}

function getAuthConfig(): AuthConfig {
  const domain = process.env.AUTH0_DOMAIN?.trim();
  const audience = process.env.AUTH0_AUDIENCE?.trim();
  const issuer = process.env.AUTH0_ISSUER?.trim() || (domain ? `https://${domain}/` : undefined);

  return { domain, audience, issuer };
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function getBearerToken(req: Request): string | null {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }

  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

function getDevUserId(req: Request): string {
  return String(req.headers['x-user-id'] || 'dev-user');
}

async function upsertUser(user: AuthenticatedUser): Promise<void> {
  const pool = getPool();
  await pool.request()
    .input('id', sql.NVarChar, user.id)
    .input('email', sql.NVarChar, user.email || null)
    .input('name', sql.NVarChar, user.name || null)
    .input('pictureUrl', sql.NVarChar, user.pictureUrl || null)
    .query(`
      MERGE Users AS target
      USING (
        SELECT
          @id AS id,
          @email AS email,
          @name AS name,
          @pictureUrl AS pictureUrl
      ) AS source
      ON target.id = source.id
      WHEN MATCHED THEN
        UPDATE SET
          email = COALESCE(source.email, target.email),
          name = COALESCE(source.name, target.name),
          pictureUrl = COALESCE(source.pictureUrl, target.pictureUrl),
          updatedAt = GETUTCDATE()
      WHEN NOT MATCHED THEN
        INSERT (id, email, name, pictureUrl)
        VALUES (source.id, source.email, source.name, source.pictureUrl);
    `);
}

function verifyAuth0Token(token: string): Promise<Auth0Claims> {
  const { domain, audience, issuer } = getAuthConfig();
  if (!domain || !audience || !issuer) {
    return Promise.reject(new Error('AUTH0_DOMAIN and AUTH0_AUDIENCE must be configured'));
  }

  const jwks = jwksClient({
    jwksUri: `https://${domain}/.well-known/jwks.json`,
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
  });

  const getKey = (header: JwtHeader, callback: jwt.SigningKeyCallback) => {
    if (!header.kid) {
      callback(new Error('JWT header is missing kid'));
      return;
    }

    jwks.getSigningKey(header.kid, (error, key) => {
      if (error) {
        callback(error);
        return;
      }

      const publicKey = key?.getPublicKey();
      if (!publicKey) {
        callback(new Error('Unable to resolve signing key'));
        return;
      }

      callback(null, publicKey);
    });
  };

  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      {
        audience,
        issuer,
        algorithms: ['RS256'],
      },
      (error, decoded) => {
        if (error) {
          reject(error);
          return;
        }

        if (!decoded || typeof decoded === 'string' || !decoded.sub) {
          reject(new Error('JWT did not contain a subject claim'));
          return;
        }

        resolve(decoded as Auth0Claims);
      }
    );
  });
}

async function resolveAuthenticatedUser(req: Request): Promise<AuthenticatedUser | null> {
  const token = getBearerToken(req);
  if (token) {
    const claims = await verifyAuth0Token(token);
    return {
      id: claims.sub,
      email: claims.email || null,
      name: claims.name || null,
      pictureUrl: claims.picture || null,
    };
  }

  if (!isProduction()) {
    const devUserId = getDevUserId(req);
    return {
      id: devUserId,
    };
  }

  return null;
}

export const authenticateRequest: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await resolveAuthenticatedUser(req);
    if (!user) {
      res.status(401).json({ error: 'Missing or invalid bearer token' });
      return;
    }

    await upsertUser(user);
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: error instanceof Error ? error.message : 'Unauthorized' });
  }
};
