import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "docs/api/**",
      "examples/**",
      "node_modules/**",
      ".npm-cache/**",
      "scripts/**",
      "test/package-smoke/**",
      "eslint.config.js",
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-restricted-types": [
        "error",
        {
          types: {
            unknown: {
              message:
                "Define and validate a concrete boundary type instead of propagating unknown.",
            },
          },
        },
      ],
    },
  },
);
