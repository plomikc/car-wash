(() => {
  const namespace = "http://www.w3.org/2000/svg";
  const buttons = document.querySelectorAll("button[data-liquid-button], a[data-liquid-button]");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const socialLinks = document.querySelector(".social-links");
  const siteBrand = document.querySelector(".site-brand");

  if (socialLinks) {
    if (socialLinks.parentElement !== document.body) {
      document.body.append(socialLinks);
    }
  }

  siteBrand?.addEventListener("click", () => {
    document.querySelector("#bookCar")?.reset();
    window.location.reload();
  });

  const createSvgElement = (name, attributes = {}) => {
    const element = document.createElementNS(namespace, name);
    Object.entries(attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
    return element;
  };

  buttons.forEach((button, index) => {
    const clipId = `liquid-button-clip-${index}`;
    const filterId = `liquid-button-filter-${index}`;
    const label = document.createElement("span");
    label.className = "liquid-button__label";

    while (button.firstChild) {
      label.append(button.firstChild);
    }

    const invertedLabel = document.createElement("span");
    invertedLabel.className = "liquid-button__inverted";
    invertedLabel.setAttribute("aria-hidden", "true");
    const labelText = label.textContent.trim();
    if (labelText) {
      invertedLabel.dataset.liquidText = labelText;
    } else {
      label.childNodes.forEach((node) => invertedLabel.append(node.cloneNode(true)));
    }
    button.append(label, invertedLabel);
    button.style.setProperty("--liquid-clip", `url(#${clipId})`);
    const isDisabled = () => button instanceof HTMLButtonElement && button.disabled;

    const svg = createSvgElement("svg", {
      class: "liquid-button__svg",
      "aria-hidden": "true",
      focusable: "false",
    });
    const definitions = createSvgElement("defs");
    const filter = createSvgElement("filter", {
      id: filterId,
      x: "-35%",
      y: "-45%",
      width: "170%",
      height: "190%",
      colorInterpolationFilters: "sRGB",
    });
    const turbulence = createSvgElement("feTurbulence", {
      type: "fractalNoise",
      baseFrequency: "0.035 0.08",
      numOctaves: "2",
      seed: "8",
      result: "liquid-noise",
    });
    const displacement = createSvgElement("feDisplacementMap", {
      in: "SourceGraphic",
      in2: "liquid-noise",
      scale: "5",
      xChannelSelector: "R",
      yChannelSelector: "G",
    });
    const clipPath = createSvgElement("clipPath", {
      id: clipId,
      clipPathUnits: "userSpaceOnUse",
    });
    const clipEllipse = createSvgElement("ellipse");
    const blob = createSvgElement("ellipse", {
      filter: `url(#${filterId})`,
      fill: "var(--liquid-fill)",
    });
    const ripple = createSvgElement("circle", {
      filter: `url(#${filterId})`,
      fill: "none",
      stroke: "var(--liquid-active-text)",
      "stroke-width": "2.4",
      display: "none",
    });

    filter.append(turbulence, displacement);
    clipPath.append(clipEllipse);
    definitions.append(filter, clipPath);
    svg.append(definitions, blob, ripple);
    button.prepend(svg);

    const state = {
      x: 0,
      y: 0,
      radius: 0,
      velocity: 0,
      stretch: 1,
      angle: 0,
      speed: 0,
      targetSpeed: 0,
      targetAngle: 0,
      lastPointerTime: 0,
      lastPointerX: 0,
      lastPointerY: 0,
      pointerActive: false,
      focusActive: false,
      frame: 0,
      lastFrame: 0,
      time: 0,
      ringStarted: 0,
      ringX: 0,
      ringY: 0,
    };

    const dimensions = () => ({
      width: button.clientWidth,
      height: button.clientHeight,
      rect: button.getBoundingClientRect(),
    });

    const setOrigin = (event) => {
      const { width, height, rect } = dimensions();
      if (!width || !height || !rect.width || !rect.height) return;
      state.x = Math.min(width, Math.max(0, ((event.clientX - rect.left) * width) / rect.width));
      state.y = Math.min(height, Math.max(0, ((event.clientY - rect.top) * height) / rect.height));

      const now = performance.now();
      if (state.lastPointerTime) {
        const elapsed = Math.max(8, now - state.lastPointerTime);
        const dx = event.clientX - state.lastPointerX;
        const dy = event.clientY - state.lastPointerY;
        state.targetSpeed = Math.min(1, Math.hypot(dx, dy) / elapsed / 1.65);
        if (Math.hypot(dx, dy) > 0.5) {
          state.targetAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
        }
      }
      state.lastPointerTime = now;
      state.lastPointerX = event.clientX;
      state.lastPointerY = event.clientY;
    };

    const render = () => {
      const { width, height } = dimensions();
      if (!width || !height) return;
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

      const axisScale = Math.sqrt(state.stretch);
      const rx = state.radius * axisScale;
      const ry = state.radius / axisScale;
      [blob, clipEllipse].forEach((ellipse) => {
        ellipse.setAttribute("cx", String(state.x));
        ellipse.setAttribute("cy", String(state.y));
        ellipse.setAttribute("rx", String(Math.max(0, rx)));
        ellipse.setAttribute("ry", String(Math.max(0, ry)));
        ellipse.setAttribute("transform", `rotate(${state.angle} ${state.x} ${state.y})`);
      });

      const ringProgress = state.ringStarted && !reducedMotion.matches
        ? Math.min(1, (performance.now() - state.ringStarted) / 550)
        : 1;
      if (state.ringStarted && !reducedMotion.matches && ringProgress < 1) {
        const radius = Math.min(width, height) * 0.58 * (1 - (1 - ringProgress) ** 3);
        ripple.setAttribute("cx", String(state.ringX));
        ripple.setAttribute("cy", String(state.ringY));
        ripple.setAttribute("r", String(radius));
        ripple.setAttribute("opacity", String(0.9 * (1 - ringProgress)));
        ripple.style.display = "block";
      } else {
        state.ringStarted = 0;
        ripple.style.display = "none";
      }

      const shimmer = reducedMotion.matches ? 0 : Math.sin(state.time * 4) * 1.5;
      displacement.setAttribute("scale", reducedMotion.matches ? "0" : String(4.5 + state.speed * 18 + shimmer));
      if (!reducedMotion.matches) {
        const breathing = 1 + Math.sin(state.time * 2.5) * 0.12;
        turbulence.setAttribute("baseFrequency", `${(0.035 * breathing).toFixed(4)} ${(0.08 * (2 - breathing)).toFixed(4)}`);
      }
    };

    const scheduleFrame = () => {
      if (!state.frame) {
        state.frame = window.requestAnimationFrame(tick);
      }
    };

    const tick = (now) => {
      state.frame = 0;
      const dt = state.lastFrame ? Math.min(1 / 30, Math.max(1 / 240, (now - state.lastFrame) / 1000)) : 1 / 60;
      state.lastFrame = now;
      state.time += dt;

      const { width, height } = dimensions();
      if (!width || !height) return;

      const active = (state.pointerActive || state.focusActive) && !isDisabled();
      state.speed += (state.targetSpeed - state.speed) * (1 - Math.exp(-dt / 0.105));
      state.targetSpeed = 0;
      const angleDelta = ((state.targetAngle - state.angle + 540) % 360) - 180;
      state.angle += angleDelta * (1 - Math.exp(-dt / 0.075));
      const targetRadius = active
        ? Math.max(
            Math.hypot(state.x, state.y),
            Math.hypot(width - state.x, state.y),
            Math.hypot(state.x, height - state.y),
            Math.hypot(width - state.x, height - state.y)
          ) * Math.sqrt(state.stretch) * 1.14
        : 0;

      if (reducedMotion.matches) {
        state.radius = targetRadius;
        state.velocity = 0;
        state.stretch = 1;
      } else {
        const acceleration = (targetRadius - state.radius) * 150 - state.velocity * 24;
        state.velocity += acceleration * dt;
        state.radius = Math.max(0, state.radius + state.velocity * dt);
        const breathing = active ? Math.sin(state.time * 2.8) * 0.04 : 0;
        const targetStretch = 1 + state.speed * 0.55 + breathing;
        state.stretch += (targetStretch - state.stretch) * (1 - Math.exp(-dt / 0.08));
        state.speed *= Math.exp(-dt / 0.105);
      }

      render();
      if (reducedMotion.matches) {
        state.lastFrame = 0;
        return;
      }

      if (active || state.ringStarted || state.radius > 0.1) {
        state.frame = window.requestAnimationFrame(tick);
      } else {
        state.lastFrame = 0;
        state.radius = 0;
        state.velocity = 0;
        state.stretch = 1;
        render();
      }
    };

    button.addEventListener("pointerenter", (event) => {
      if (isDisabled() || event.pointerType === "touch") return;
      state.pointerActive = true;
      setOrigin(event);
      scheduleFrame();
    });

    button.addEventListener("pointermove", (event) => {
      if (isDisabled() || event.pointerType === "touch") return;
      setOrigin(event);
      scheduleFrame();
    });

    button.addEventListener("pointerleave", () => {
      state.pointerActive = false;
      state.lastPointerTime = 0;
      scheduleFrame();
    });

    button.addEventListener("pointerdown", (event) => {
      if (isDisabled()) return;
      state.pointerActive = true;
      setOrigin(event);
      state.ringX = state.x;
      state.ringY = state.y;
      state.ringStarted = reducedMotion.matches ? 0 : performance.now();
      state.velocity += 150;
      scheduleFrame();
    });

    button.addEventListener("pointerup", (event) => {
      if (event.pointerType === "touch") {
        state.pointerActive = false;
        scheduleFrame();
      }
    });

    button.addEventListener("pointercancel", () => {
      state.pointerActive = false;
      state.lastPointerTime = 0;
      scheduleFrame();
    });

    button.addEventListener("focus", () => {
      if (!button.matches(":focus-visible") || isDisabled()) return;
      const { width, height } = dimensions();
      state.x = width / 2;
      state.y = height / 2;
      state.focusActive = true;
      scheduleFrame();
    });

    button.addEventListener("blur", () => {
      state.focusActive = false;
      scheduleFrame();
    });

    const syncSize = () => {
      const { width, height } = dimensions();
      if (width && height && state.x === 0 && state.y === 0) {
        state.x = width / 2;
        state.y = height / 2;
      }
      render();
    };

    if ("ResizeObserver" in window) {
      new ResizeObserver(syncSize).observe(button);
    } else {
      window.addEventListener("resize", syncSize);
    }
    syncSize();
  });
})();
