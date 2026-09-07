export const webPolicy: {
  readonly root: string;
  readonly build: string;
  readonly generatedRoute: string;
  readonly paths: Readonly<Record<string, readonly string[]>>;
} = {
  root: "packages/web",
  build: "vite build",
  generatedRoute: "src/routeTree.gen.ts",
  paths: { "@/*": ["./src/*"] },
};
