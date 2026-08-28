import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { SiteShell } from "@/components/site-shell";
import { Toaster } from "sonner";
import { asset } from "@/lib/utils";
import appCss from "../styles.css?url";

const APP_NAME = "DDL Tourney - Legends Bracket";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      { name: "theme-color", content: "#140a04" },
      {
        name: "description",
        content:
          "Doginal Dogs Legends tournament arena — crypto entry fees, live rosters, and Challonge-style brackets.",
      },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: asset("favicon.svg") },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: asset("__grok/manifest.webmanifest") },
      { rel: "apple-touch-icon", href: asset("__grok/icon-180.png") },
    ],
  }),
  component: Root,
});

function Root() {
  return (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-bg text-fg font-sans min-h-dvh">
        <PreviewHostBridge />
        <AuthProvider>
          <SiteShell>
            <Outlet />
          </SiteShell>
          <Toaster
            theme="dark"
            position="bottom-center"
            toastOptions={{
              className: "font-sans",
              style: {
                background: "#1c1008",
                border: "1px solid #5c3a18",
                color: "#f6e7c8",
              },
            }}
          />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}
