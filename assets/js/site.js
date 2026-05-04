const videos = Array.from(document.querySelectorAll("video"));

const pauseAwayVideos = () => {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting && !entry.target.paused) {
          entry.target.pause();
        }
      });
    },
    { threshold: 0.15 }
  );

  videos.forEach((video) => observer.observe(video));
};

const markReadyVideos = () => {
  videos.forEach((video) => {
    video.addEventListener(
      "loadedmetadata",
      () => {
        video.classList.add("is-ready");
      },
      { once: true }
    );
  });
};

markReadyVideos();

if ("IntersectionObserver" in window) {
  pauseAwayVideos();
}
