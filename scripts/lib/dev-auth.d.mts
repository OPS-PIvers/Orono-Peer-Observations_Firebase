export const DEV_AUTH_SECRET_HEADER: 'x-dev-auth-secret';
export function devAuthSecretPath(port: number | string): string;
export function isLoopbackHost(host: string | undefined): boolean;
export const ALLOWED_DEV_ORIGINS: ReadonlySet<string>;
export function isAllowedDevOrigin(origin: string): boolean;
