/**
 * MSW Server for Node.js (Vitest)
 *
 * Sets up the Mock Service Worker server for unit and integration tests.
 * This server intercepts HTTP requests during tests and returns mock responses.
 */

import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);
