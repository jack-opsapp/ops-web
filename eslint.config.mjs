import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "prefer-const": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // Every toast must render through the tokenized wrapper so the OPS
      // status rail, glass-dense surface, and motion stay consistent.
      // Raw `sonner` imports are forbidden everywhere except the wrapper.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "sonner",
              message:
                'Import { toast } from "@/components/ui/toast" — the tokenized wrapper — never raw sonner.',
            },
          ],
        },
      ],
    },
  },
  {
    // The wrapper is the one sanctioned place that imports raw sonner.
    files: ["src/components/ui/toast.tsx"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];

export default eslintConfig;
