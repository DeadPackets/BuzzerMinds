"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * Wireframe Banner background: Three.js wireframe octahedrons + CSS diagonal line pattern.
 * Renders 10 slowly rotating/drifting wireframe octahedrons in amber/sage/rose.
 */

export function WireframeBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.z = 18;

    const colors = [
      new THREE.Color("#f59e0b"), // amber
      new THREE.Color("#4ade80"), // sage
      new THREE.Color("#fb7185"), // rose
    ];

    interface Shape {
      mesh: THREE.LineSegments;
      rotSpeed: { x: number; y: number; z: number };
      driftSpeed: { x: number; y: number };
    }

    const shapes: Shape[] = [];

    for (let i = 0; i < 10; i++) {
      const size = 0.6 + Math.random() * 1.8;
      const geometry = new THREE.OctahedronGeometry(size, 0);
      const wireframe = new THREE.WireframeGeometry(geometry);
      const color = colors[i % 3];
      const opacity = 0.12 + Math.random() * 0.06;
      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity,
      });
      const lineSegments = new THREE.LineSegments(wireframe, material);

      lineSegments.position.set(
        (Math.random() - 0.5) * 30,
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 12
      );

      const rotSpeed = {
        x: (Math.random() - 0.5) * 0.004,
        y: (Math.random() - 0.5) * 0.006,
        z: (Math.random() - 0.5) * 0.003,
      };

      const driftSpeed = {
        x: (Math.random() - 0.5) * 0.003,
        y: (Math.random() - 0.5) * 0.002,
      };

      shapes.push({ mesh: lineSegments, rotSpeed, driftSpeed });
      scene.add(lineSegments);
    }

    function animate() {
      frameRef.current = requestAnimationFrame(animate);

      shapes.forEach((s) => {
        s.mesh.rotation.x += s.rotSpeed.x;
        s.mesh.rotation.y += s.rotSpeed.y;
        s.mesh.rotation.z += s.rotSpeed.z;
        s.mesh.position.x += s.driftSpeed.x;
        s.mesh.position.y += s.driftSpeed.y;

        // Wrap around
        if (s.mesh.position.x > 18) s.mesh.position.x = -18;
        if (s.mesh.position.x < -18) s.mesh.position.x = 18;
        if (s.mesh.position.y > 12) s.mesh.position.y = -12;
        if (s.mesh.position.y < -12) s.mesh.position.y = 12;
      });

      renderer.render(scene, camera);
    }

    animate();

    function onResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }

    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frameRef.current);
      renderer.dispose();
      shapes.forEach((s) => {
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.LineBasicMaterial).dispose();
      });
    };
  }, []);

  return (
    <>
      {/* CSS diagonal line pattern */}
      <div className="bm-bg-pattern" aria-hidden="true" />
      {/* Three.js wireframe canvas */}
      <canvas ref={canvasRef} className="bm-bg-canvas" aria-hidden="true" />
    </>
  );
}
