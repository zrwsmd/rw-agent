import './globals.css';
import { ReactNode } from 'react';
import Script from 'next/script';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Script
          id="orchids-browser-logs"
          src="https://slelguoygbfzlpylpxfs.supabase.co/storage/v1/object/public/scripts/orchids-browser-logs.js"
          strategy="afterInteractive"
          data-orchids-project-id="bcbd37fb-db6d-43e5-8fa2-7b529810a565"
        />
        {children}
      </body>
    </html>
  );
}