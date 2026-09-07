import { createFileRoute } from "@tanstack/react-router";
import { Overview } from "../pages.tsx";

export const Route = createFileRoute(
  // Stryker disable next-line all: The file-route key is type-only; the generated tree supplies the runtime path.
  "/",
)({ component: Overview });
