/* eslint-disable */
// @dioramai-generated
/* This file is owned by Dioramai. Edit dioramaiScene for MVP code -> runtime sync. */
import { Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';

type Vec3 = readonly [number, number, number];
type DioramaiNode = {
  id: string;
  name: string;
  type: 'root' | 'group' | 'mesh' | 'light' | 'empty';
  visible: boolean;
  children: readonly string[];
  transform: { position: Vec3; rotation: Vec3; scale: Vec3 };
  metadata: Record<string, unknown>;
  assetRef?: { kind: 'none' } | { kind: 'uri'; uri: string };
  light?: { kind: 'ambient'; intensity?: number } | { kind: 'directional'; intensity?: number; castShadow?: boolean };
  [key: string]: unknown;
};
type DioramaiSceneData = { rootId: string; nodes: Record<string, DioramaiNode>; [key: string]: unknown };
type DioramaiSceneDocument = { format: 'dioramai-scene'; version: 2; data: DioramaiSceneData };

export const dioramaiScene = (
// @dioramai-scene-start
{
  "data": {
    "assets": {
      "asset-meshy_ai_tiny_village_in_a_woo_0511004150_texture": {
        "id": "asset-meshy_ai_tiny_village_in_a_woo_0511004150_texture",
        "kind": "glb",
        "metadata": {
          "importSource": "workspacePath",
          "importedFrom": "public/assets/models/Meshy_AI_Tiny_Village_in_a_Woo_0511004150_texture.glb",
          "localPath": "public/assets/models/Meshy_AI_Tiny_Village_in_a_Woo_0511004150_texture.glb",
          "provider": "manual",
          "source": "manual"
        },
        "name": "Meshy_AI_Tiny_Village_in_a_Woo_0511004150_texture",
        "source": "manual",
        "uri": "/assets/models/Meshy_AI_Tiny_Village_in_a_Woo_0511004150_texture.glb"
      }
    },
    "nodes": {
      "asset-meshy_ai_tiny_village_in_a_woo_0511004150_texture-node": {
        "assetRef": {
          "kind": "uri",
          "uri": "/assets/models/Meshy_AI_Tiny_Village_in_a_Woo_0511004150_texture.glb"
        },
        "children": [],
        "id": "asset-meshy_ai_tiny_village_in_a_woo_0511004150_texture-node",
        "metadata": {
          "assetId": "asset-meshy_ai_tiny_village_in_a_woo_0511004150_texture",
          "localPath": "public/assets/models/Meshy_AI_Tiny_Village_in_a_Woo_0511004150_texture.glb",
          "provider": "manual",
          "source": "manual"
        },
        "name": "meshy_ai_tiny_village_in_a_woo_0511004150_texture Product",
        "semanticRole": "product",
        "semantics": {
          "role": "product",
          "source": "import"
        },
        "transform": {
          "position": [
            -5.025475241292788,
            0,
            0
          ],
          "rotation": [
            0,
            0,
            0
          ],
          "scale": [
            1,
            1,
            1
          ]
        },
        "type": "mesh",
        "visible": true
      },
      "default-cube-1": {
        "children": [],
        "id": "default-cube-1",
        "metadata": {},
        "name": "Cube 1",
        "transform": {
          "position": [
            0,
            0.5,
            0
          ],
          "rotation": [
            0,
            0,
            0
          ],
          "scale": [
            1,
            1,
            1
          ]
        },
        "type": "mesh",
        "visible": true
      },
      "default-root": {
        "children": [
          "default-cube-1",
          "asset-meshy_ai_tiny_village_in_a_woo_0511004150_texture-node"
        ],
        "id": "default-root",
        "metadata": {},
        "name": "Root",
        "transform": {
          "position": [
            0,
            0,
            0
          ],
          "rotation": [
            0,
            0,
            0
          ],
          "scale": [
            1,
            1,
            1
          ]
        },
        "type": "root",
        "visible": true
      }
    },
    "rootId": "default-root",
    "selection": null
  },
  "format": "dioramai-scene",
  "version": 2
}
// @dioramai-scene-end
) as const satisfies DioramaiSceneDocument;

function vec3(value: Vec3): [number, number, number] {
  return [value[0], value[1], value[2]];
}

function isRenderableAssetUri(uri: string | undefined): string | undefined {
  if (!uri || !/\.(glb|gltf)(\?|#|$)/i.test(uri)) return undefined;
  if (uri.startsWith('file://') || uri.startsWith('http://') || uri.startsWith('https://')) return undefined;
  if (uri.includes('/Users/') || uri.includes('\\Users\\')) return undefined;
  if (/^[a-zA-Z]:\\/.test(uri)) return undefined;
  if (uri.startsWith('/assets/') || uri.startsWith('assets/') || uri.startsWith('./') || uri.startsWith('../')) return uri;
  return undefined;
}

function AssetModel({ uri }: { uri: string }) {
  const gltf = useGLTF(uri);
  const object = useMemo(() => SkeletonUtils.clone(gltf.scene), [gltf.scene]);
  return <primitive object={object} />;
}

function ProxyMesh() {
  return (
    <mesh castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#94a3b8" />
    </mesh>
  );
}

function SceneNode({ scene, nodeId }: { scene: DioramaiSceneData; nodeId: string }) {
  const node = scene.nodes[nodeId];
  if (!node || node.visible === false) return null;
  const hasLight = node.light !== undefined || node.type === 'light';
  const inspectOnly = node.metadata.renderMode === 'gltf-inspect-only';
  const assetUri = isRenderableAssetUri(node.assetRef?.kind === 'uri' ? node.assetRef.uri : undefined);
  const showMesh = node.type === 'mesh' && !hasLight && !inspectOnly;
  const showAsset = showMesh && assetUri !== undefined;
  const showProxy = showMesh && !showAsset;
  return (
    <group
      name={node.name}
      position={vec3(node.transform.position)}
      rotation={vec3(node.transform.rotation)}
      scale={vec3(node.transform.scale)}
      userData={{ dioramaiId: node.id, sourceId: node.id }}
    >
      {hasLight && node.light?.kind === 'ambient' ? <ambientLight intensity={node.light.intensity ?? 0.4} /> : null}
      {hasLight && node.light?.kind === 'directional' ? <directionalLight intensity={node.light.intensity ?? 1} castShadow={node.light.castShadow} /> : null}
      {showAsset ? (
        <Suspense fallback={<ProxyMesh />}>
          <AssetModel uri={assetUri} />
        </Suspense>
      ) : null}
      {showProxy ? <ProxyMesh /> : null}
      {node.children.map((childId) => <SceneNode key={childId} scene={scene} nodeId={childId} />)}
    </group>
  );
}

export function DioramaiScene() {
  const scene = dioramaiScene.data;
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight castShadow position={[5, 8, 5]} intensity={1.1} />
      <SceneNode scene={scene} nodeId={scene.rootId} />
    </>
  );
}
