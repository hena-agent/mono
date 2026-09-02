export default {
  test: {
    exclude: [".stryker-tmp/**", "dist/**", "node_modules/**"],
    include: ["src/**/*.test.{ts,tsx,mts,cts}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx,mts,cts}"],
      exclude: [
        ".stryker-tmp/**",
        "dist/**",
        "src/**/*.test.{ts,tsx,mts,cts}",
        "src/**/*.test-d.{ts,tsx,mts,cts}",
      ],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
};
