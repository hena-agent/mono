import { HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";

export function Document({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
