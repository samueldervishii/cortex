(function () {
  const nav = document.querySelector(".nav");
  const toggle = nav && nav.querySelector(".nav-toggle");
  const links = nav && nav.querySelector(".nav-links");
  if (!nav || !toggle || !links) return;

  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "primary-nav");
  links.id = links.id || "primary-nav";

  const setOpen = (open) => {
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  };

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(!nav.classList.contains("is-open"));
  });

  links.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setOpen(false));
  });

  document.addEventListener("click", (event) => {
    if (!nav.classList.contains("is-open")) return;
    if (!nav.contains(event.target)) setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });
})();
