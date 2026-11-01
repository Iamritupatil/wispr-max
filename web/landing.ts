// The landing page: the demo video with chapters, and download buttons that go
// straight to the installer for this computer.

const yt = document.getElementById("yt") as HTMLIFrameElement;
const embed = (start = 0, autoplay = false) =>
  `https://www.youtube-nocookie.com/embed/${yt.dataset.video}?rel=0&start=${start}${autoplay ? "&autoplay=1" : ""}`;
yt.src = embed();

for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-t]"))) {
  b.addEventListener("click", () => {
    yt.src = embed(Number(b.dataset.t), true);
    document.querySelectorAll("[data-t]").forEach((x) => x.classList.toggle("on", x === b));
  });
}

// ---------- download: the right installer for this computer ----------

type UAData = { platform?: string };
const uaData = (navigator as { userAgentData?: UAData }).userAgentData;
const platform = (uaData?.platform || navigator.platform || navigator.userAgent).toLowerCase();
const os = /mac|iphone|ipad/.test(platform) ? "mac" : /linux|x11/.test(platform) && !/android/.test(platform) ? "linux" : "win";
const OS_NAME = { win: "Windows", mac: "Mac", linux: "Linux" }[os];
const arch = os === "mac" ? "arm64" : "x64";

document.querySelectorAll<HTMLElement>("[data-download-label]").forEach((el) => (el.textContent = `Download for ${OS_NAME}`));
document.querySelectorAll<HTMLAnchorElement>("[data-download]").forEach((a) => {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    location.href = `/api/download?os=${os}&arch=${arch}`;
    if (a.nextElementSibling?.classList.contains("install-help")) return;
    const help = document.createElement("p");
    help.className = "install-help";
    help.textContent =
      os === "win"
        ? "If Windows says “Windows protected your PC”, click More info → Run anyway. The app isn't code-signed yet."
        : os === "mac"
          ? "If macOS says the developer can't be verified, right-click the app → Open → Open, the first time."
          : "Make the AppImage executable (chmod +x) and run it.";
    a.insertAdjacentElement("afterend", help);
  });
});
