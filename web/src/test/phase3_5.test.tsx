import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as THREE from 'three';
import fs from 'fs';
import path from 'path';

import { createTaperedTubeGeometry } from '../utils/taperedTube';
import { defaultHeartTransform } from '../anatomy';
import { AboutTab } from '../components/AboutTab';
import heartTransformData from '../anatomy/heartTransform.json';

describe('Phase 3.5: Real Heart Mesh Integration & Polish', () => {
  // 1. heartTransform.json verification
  it('loads valid heartTransform.json with normalization properties', () => {
    expect(defaultHeartTransform).toBeDefined();
    expect(Array.isArray(defaultHeartTransform.position)).toBe(true);
    expect(defaultHeartTransform.position.length).toBe(3);
    expect(Array.isArray(defaultHeartTransform.rotation)).toBe(true);
    expect(defaultHeartTransform.rotation.length).toBe(3);
    expect(Array.isArray(defaultHeartTransform.scale)).toBe(true);
    expect(defaultHeartTransform.scale.length).toBe(3);
    expect(heartTransformData).toEqual(defaultHeartTransform);
  });

  // 2. createTaperedTubeGeometry verification
  it('generates a tapered tube along a CatmullRomCurve3', () => {
    const points = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0.5, 0.2),
      new THREE.Vector3(0.1, 1.0, 0.4),
    ];
    const curve = new THREE.CatmullRomCurve3(points);
    const startRadius = 0.06;
    const endRadius = 0.03;
    const tubularSegments = 32;
    const radialSegments = 8;

    const geom = createTaperedTubeGeometry(curve, tubularSegments, startRadius, endRadius, radialSegments);

    expect(geom).toBeDefined();
    expect(geom.attributes.position).toBeDefined();
    expect(geom.attributes.normal).toBeDefined();
    expect(geom.attributes.uv).toBeDefined();
    expect(geom.index).toBeDefined();

    // Check vertex count: (tubularSegments + 1) * (radialSegments + 1)
    const expectedVertices = (tubularSegments + 1) * (radialSegments + 1);
    expect(geom.attributes.position.count).toBe(expectedVertices);

    // Check triangle count: tubularSegments * radialSegments * 2
    const expectedTriangles = tubularSegments * radialSegments * 2;
    expect(geom.index!.count / 3).toBe(expectedTriangles);
  });

  // 3. Exact credit sentence in About tab and ATTRIBUTION.txt
  it('verifies exact credit sentence from ATTRIBUTION.txt in About tab', () => {
    render(<AboutTab />);
    const creditSentence = 'Heart model by Hannah Newey, University of Dundee (CAHID), CC BY-NC-SA 4.0';
    expect(screen.getByText((content) => content.includes(creditSentence))).toBeInTheDocument();

    const attributionFilePath = path.resolve(__dirname, '../../public/models/ATTRIBUTION.txt');
    const expectedContent = fs.readFileSync(attributionFilePath, 'utf8').trim();
    const renderedAttr = screen.getByTestId('heart-attribution-text');
    expect(renderedAttr.textContent?.trim()).toBe(expectedContent);
  });

  // 4. Banned phrases audit across web/src
  it('guarantees forbidden phrases are absent from all source files in web/src', () => {
    const srcDir = path.resolve(__dirname, '..');
    const forbiddenPatterns = [
      /\bmoderate\s+risk\b/i,
      /\bwell\s+above\b/i,
    ];

    function checkDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__fixtures__' && entry.name !== 'node_modules') {
            checkDir(fullPath);
          }
        } else if (/\.(ts|tsx|json)$/.test(entry.name)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          for (const pattern of forbiddenPatterns) {
            expect(content).not.toMatch(pattern);
          }
        }
      }
    }

    checkDir(srcDir);
  });
});
