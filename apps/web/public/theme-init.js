// Apply the saved preference before the body is painted.
(() => {
  let theme = "system";
  try {
    const saved = localStorage.getItem("gbp-theme");
    if (saved === "light" || saved === "dark") theme = saved;
  } catch {}
  document.documentElement.dataset.theme =
    theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
})();
