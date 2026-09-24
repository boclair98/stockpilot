import { defineConfig } from "@apps-in-toss/web-framework/config";

export default defineConfig({
  appName: "stockpilot-kr",
  brand: { primaryColor: "#3182F6" },
  permissions: [],
  navigationBar: {
    withBackButton: true,
    withHomeButton: true,
    withTitle: true,
    transparentBackground: false,
    theme: "light",
  },
  webView: {
    bounces: false,
    pullToRefreshEnabled: false,
    overScrollMode: "never",
    allowsBackForwardNavigationGestures: true,
  },
  webBundleDir: "dist",
});
