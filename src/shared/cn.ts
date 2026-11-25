import { clsx, type ClassValue } from 'clsx';

/** Join class names conditionally (thin wrapper over clsx). */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
