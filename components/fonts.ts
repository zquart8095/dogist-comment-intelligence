// Report-only fonts, scoped via CSS variables on the report root so they never touch globals.css.
import { Bebas_Neue, Public_Sans, JetBrains_Mono } from 'next/font/google';

export const bebasNeue = Bebas_Neue({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--air-font-display',
  display: 'swap',
});

export const publicSans = Public_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--air-font-body',
  display: 'swap',
});

export const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--air-font-mono',
  display: 'swap',
});

export const fontVars = `${bebasNeue.variable} ${publicSans.variable} ${jetBrainsMono.variable}`;
