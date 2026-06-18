import { useEffect, useRef } from "react";

// Immersive 3D background: a faceted crystal that reacts to the mouse + drifting
// snow + fog. Three.js is loaded from the CDN at runtime; any failure is silent
// (the CSS aurora remains as a fallback).
const THREE_CDN = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

export default function HeroFX() {
  const ref = useRef(null);
  useEffect(() => {
    let renderer, frame, disposed = false, onMove, onResize;
    let mx = 0, my = 0;
    (async () => {
      try {
        const THREE = await import(/* @vite-ignore */ THREE_CDN);
        const canvas = ref.current;
        if (!canvas || disposed) return;

        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);

        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x0a130e, 0.055);
        const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
        camera.position.z = 8.5;

        // faceted crystal (emerald) + gold wireframe shell
        const geo = new THREE.IcosahedronGeometry(2.5, 1);
        const crystal = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
          color: 0x1fbf75, metalness: 0.65, roughness: 0.18, flatShading: true,
          emissive: 0x0c4730, emissiveIntensity: 0.55, transparent: true, opacity: 0.92,
        }));
        scene.add(crystal);
        const shell = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          color: 0xe8b54a, wireframe: true, transparent: true, opacity: 0.22,
        }));
        shell.scale.setScalar(1.06);
        crystal.add(shell);

        // lights
        scene.add(new THREE.AmbientLight(0x335544, 1.1));
        const lA = new THREE.PointLight(0x2fe39a, 70, 80); lA.position.set(7, 7, 9); scene.add(lA);
        const lB = new THREE.PointLight(0xe8b54a, 45, 80); lB.position.set(-9, -5, 5); scene.add(lB);

        // snow / particles
        const N = 1000;
        const arr = new Float32Array(N * 3);
        for (let i = 0; i < N; i++) {
          arr[i * 3] = (Math.random() - 0.5) * 46;
          arr[i * 3 + 1] = (Math.random() - 0.5) * 34;
          arr[i * 3 + 2] = (Math.random() - 0.5) * 34;
        }
        const pgeo = new THREE.BufferGeometry();
        pgeo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
        const points = new THREE.Points(pgeo, new THREE.PointsMaterial({
          color: 0xcfeede, size: 0.07, transparent: true, opacity: 0.7, depthWrite: false,
        }));
        scene.add(points);

        onMove = (e) => { mx = e.clientX / window.innerWidth - 0.5; my = e.clientY / window.innerHeight - 0.5; };
        onResize = () => {
          camera.aspect = window.innerWidth / window.innerHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener("pointermove", onMove, { passive: true });
        window.addEventListener("resize", onResize);

        const clock = new THREE.Clock();
        const tick = () => {
          if (disposed) return;
          frame = requestAnimationFrame(tick);
          const t = clock.getElapsedTime();
          crystal.rotation.x = t * 0.15 + my * 0.6;
          crystal.rotation.y = t * 0.22 + mx * 0.9;
          crystal.scale.setScalar(1 + Math.sin(t * 1.4) * 0.035);
          points.rotation.y = t * 0.02;
          const pa = pgeo.attributes.position.array;
          for (let i = 1; i < pa.length; i += 3) { pa[i] -= 0.012; if (pa[i] < -17) pa[i] = 17; }
          pgeo.attributes.position.needsUpdate = true;
          camera.position.x += (mx * 2.2 - camera.position.x) * 0.045;
          camera.position.y += (-my * 2.2 - camera.position.y) * 0.045;
          camera.lookAt(0, 0, 0);
          renderer.render(scene, camera);
        };
        tick();
      } catch (e) { /* WebGL unavailable -> silent fallback */ }
    })();

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      if (onMove) window.removeEventListener("pointermove", onMove);
      if (onResize) window.removeEventListener("resize", onResize);
      try { renderer && renderer.dispose(); } catch (e) {}
    };
  }, []);

  return <canvas ref={ref} className="hero-fx" aria-hidden="true" />;
}
