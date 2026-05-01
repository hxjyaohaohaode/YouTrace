import jwt, { type SignOptions } from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN: string = process.env.JWT_EXPIRES_IN || '7d';

if (!JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
}

if (JWT_SECRET.length < 32 && process.env.NODE_ENV === 'production') {
  console.error('[FATAL] JWT_SECRET is too short for production. Use at least 32 characters.');
  process.exit(1);
}

interface TokenPayload {
  userId: string;
  phone: string;
}

export const generateToken = (payload: TokenPayload): string => {
  const options: SignOptions = {
    expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  };
  return jwt.sign(payload, JWT_SECRET, options);
};

export const verifyToken = (token: string): TokenPayload => {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
};

export const verifyTokenAllowExpired = (token: string): TokenPayload => {
  return jwt.verify(token, JWT_SECRET, { ignoreExpiration: true }) as TokenPayload;
};
