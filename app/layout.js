import localFont from 'next/font/local'
import './globals.css'
import { ThemeProvider } from './providers'

/* Two faces, product-wide: Inter for everything readable, DM Mono for figures,
   keycaps and labels that need to hold a column.

   Syne and DM Sans used to load here as well, purely for the landing, login
   and signup pages — three surfaces that looked like a different product to
   anyone arriving from the app. Removing them drops two full font families
   off the critical path of the first page anyone ever sees.

   --ds-font-head still resolves to Inter today, but it stays a separate token
   so headings can be given a display face later by editing globals.css alone,
   rather than revisiting every call site again. */

const inter = localFont({
  src: [{ path: './fonts/inter-variable.woff2', style: 'normal' }],
  weight: '100 900',
  variable: '--font-inter',
  display: 'swap',
  adjustFontFallback: 'Arial',
})

const dmMono = localFont({
  src: [
    { path: './fonts/dm-mono-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/dm-mono-500.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-dm-mono',
  display: 'swap',
  adjustFontFallback: false,
})

export const metadata = {
  title: 'DataStudio — Excel, reimagined.',
  description: 'Import multiple spreadsheets, drag columns onto a canvas, crosscheck data and export a clean custom file in seconds.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${dmMono.variable}`}>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
