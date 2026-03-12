import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Homingo",
  description: "Detect, diagnose, and fix routing drift in AI skill deployments.",

  // Deploy to GitHub Pages at https://homingo.github.io
  // Repo named homingo.github.io → served at root, no base path needed

  head: [["link", { rel: "icon", href: "/favicon.ico" }]],

  themeConfig: {
    logo: "/logo.png",

    nav: [
      { text: "Guide", link: "/getting-started" },
      { text: "Commands", link: "/commands/scan" },
      { text: "Concepts", link: "/concepts/routing-drift" },
      {
        text: "v0.8.0",
        items: [
          {
            text: "Changelog",
            link: "https://github.com/homingo/homingo.github.io/blob/main/CHANGELOG.md",
          },
          {
            text: "Contributing",
            link: "https://github.com/homingo/homingo.github.io/blob/main/CONTRIBUTING.md",
          },
        ],
      },
    ],

    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/getting-started" },
          { text: "Configuration", link: "/configuration" },
        ],
      },
      {
        text: "Commands",
        items: [
          { text: "scan", link: "/commands/scan" },
          { text: "audit", link: "/commands/audit" },
          { text: "lint", link: "/commands/lint" },
          { text: "init", link: "/commands/init" },
          { text: "logs", link: "/commands/logs" },
        ],
      },
      {
        text: "Concepts",
        items: [
          { text: "Routing Drift", link: "/concepts/routing-drift" },
          { text: "Shadow Router", link: "/concepts/shadow-router" },
          { text: "Scope Overload", link: "/concepts/scope-overload" },
          { text: "Skill Format", link: "/concepts/skill-format" },
        ],
      },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/homingo/homingo.github.io" }],

    editLink: {
      pattern: "https://github.com/homingo/homingo.github.io/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    search: {
      provider: "local",
    },

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2026 Ravi Yenduri",
    },
  },
});
