/** Test mode's clock scale, shared by the frame loop and CSS animations/transitions. */
export class TestPlayback {
  rate = 1;
  private readonly root: HTMLElement;
  private readonly observer: MutationObserver;

  constructor(root: HTMLElement) {
    this.root = root;
    // React creates overlays after game events; update those animations as they appear.
    this.observer = new MutationObserver((records) => {
      if (records.some((record) => record.type === "attributes" || [...record.addedNodes].some((node) => node.nodeType === 1))) this.sync();
    });
    this.observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    root.addEventListener("animationstart", this.sync);
    root.addEventListener("transitionrun", this.sync);
  }

  toggle() {
    this.rate = this.rate === 1 ? 0.5 : 1;
    this.sync();
    return this.rate;
  }

  private sync = () => {
    for (const animation of this.root.getAnimations({ subtree: true })) {
      if (animation.playbackRate !== this.rate) animation.updatePlaybackRate(this.rate);
    }
  };

  dispose() {
    this.observer.disconnect();
    this.root.removeEventListener("animationstart", this.sync);
    this.root.removeEventListener("transitionrun", this.sync);
    this.rate = 1;
    this.sync();
  }
}
