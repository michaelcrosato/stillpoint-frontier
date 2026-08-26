export default function Home() {
  return (
    <main
      style={{
        width: "100vw",
        height: "100svh",
        overflow: "hidden",
        background: "#071013",
      }}
    >
      <iframe
        src="/playcanvas/index.html"
        title="Stillpoint Frontier"
        allow="autoplay; fullscreen; gamepad"
        allowFullScreen
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          border: 0,
        }}
      />
    </main>
  );
}
