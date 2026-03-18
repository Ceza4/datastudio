import { Syne, DM_Sans, DM_Mono } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from './providers'

const syne = Syne({
  subsets: ['latin'],
  variable: '--font-syne',
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
})

const dmMono = DM_Mono({
  weight: ['400', '500'],
  subsets: ['latin'],
  variable: '--font-dm-mono',
})

export const metadata = {
  title: 'DataStudio — Excel, reimagined.',
  description: 'Import multiple spreadsheets, drag columns onto a canvas, crosscheck data and export a clean custom file in seconds.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${syne.variable} ${dmSans.variable} ${dmMono.variable}`}>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}