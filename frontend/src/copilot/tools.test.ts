import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { IMMEDIATELY: "IMMEDIATELY" },
  convertToExcalidrawElements: (skeletons: any[]) =>
    skeletons.map((skeleton, index) => ({
      id: skeleton.id || `generated-${index}`,
      width: 0,
      height: 0,
      ...skeleton,
    })),
  getCommonBounds: (elements: any[]) => [
    Math.min(...elements.map((element) => element.x)),
    Math.min(...elements.map((element) => element.y)),
    Math.max(...elements.map((element) => element.x + element.width)),
    Math.max(...elements.map((element) => element.y + element.height)),
  ],
  getVisibleSceneBounds: (appState: any) =>
    appState.visibleBounds || [0, 0, 1000, 800],
}));

import { TOOLS_BY_NAME, type ExcalidrawApi } from "./tools";

const existingElement = {
  id: "custom-diagram",
  type: "rectangle",
  x: 0,
  y: 0,
  width: 400,
  height: 300,
};

const makeApi = (
  visibleElements: any[] = [existingElement],
  appState: any = { selectedElementIds: {}, visibleBounds: [0, 0, 1000, 800] },
) => {
  const updateScene = vi.fn();
  const scrollToContent = vi.fn();
  const api: ExcalidrawApi = {
    getSceneElements: () => visibleElements,
    getSceneElementsIncludingDeleted: () => visibleElements,
    getAppState: () => appState,
    updateScene,
    scrollToContent,
  };
  return { api, updateScene, scrollToContent };
};

describe("co-pilot element insertion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("moves an overlapping generated group beside existing content and captures one undo step", async () => {
    const { api, updateScene, scrollToContent } = makeApi();

    await TOOLS_BY_NAME.add_elements.handler(api, {
      skeletons: [
        { type: "rectangle", x: 100, y: 100, width: 200, height: 100 },
      ],
    });

    expect(updateScene).toHaveBeenCalledOnce();
    const update = updateScene.mock.calls[0][0];
    const generated = update.elements[1];
    expect(generated).toMatchObject({ id: "generated-0", x: 520, y: 0 });
    expect(update.appState.selectedElementIds).toEqual({ "generated-0": true });
    expect(update.captureUpdate).toBe("IMMEDIATELY");
    expect(scrollToContent).toHaveBeenCalledWith([generated], {
      fitToContent: true,
      animate: true,
    });
  });

  it("anchors beside the selection instead of the far edge of the whole scene", async () => {
    const selected = { ...existingElement, id: "selected" };
    const remote = { ...existingElement, id: "remote", x: 1400 };
    const { api, updateScene } = makeApi([selected, remote], {
      selectedElementIds: { selected: true },
      visibleBounds: [-100, -100, 900, 700],
    });

    await TOOLS_BY_NAME.add_elements.handler(api, {
      skeletons: [
        { type: "rectangle", x: 100, y: 100, width: 200, height: 100 },
      ],
    });

    expect(updateScene.mock.calls[0][0].elements[2]).toMatchObject({
      x: 520,
      y: 0,
    });
  });

  it("uses the next open side when the selected element's right side is occupied", async () => {
    const blocker = {
      ...existingElement,
      id: "blocker",
      x: 520,
      width: 200,
      height: 100,
    };
    const { api, updateScene } = makeApi([existingElement, blocker], {
      selectedElementIds: { "custom-diagram": true },
      visibleBounds: [-100, -100, 1000, 800],
    });

    await TOOLS_BY_NAME.add_elements.handler(api, {
      skeletons: [
        { type: "rectangle", x: 100, y: 100, width: 200, height: 100 },
      ],
    });

    expect(updateScene.mock.calls[0][0].elements[2]).toMatchObject({
      x: 0,
      y: 420,
    });
  });

  it("centers generated content in the viewport on an empty board", async () => {
    const { api, updateScene } = makeApi([], {
      selectedElementIds: {},
      visibleBounds: [1000, 500, 1800, 1100],
    });

    await TOOLS_BY_NAME.add_elements.handler(api, {
      skeletons: [{ type: "rectangle", x: 0, y: 0, width: 200, height: 100 }],
    });

    expect(updateScene.mock.calls[0][0].elements[0]).toMatchObject({
      x: 1300,
      y: 750,
    });
  });

  it("anchors to visible work instead of a remote scene edge when nothing is selected", async () => {
    const origin = { ...existingElement, id: "origin" };
    const visible = { ...existingElement, id: "visible", x: 1000, y: 600 };
    const remote = { ...existingElement, id: "remote", x: 5000 };
    const { api, updateScene } = makeApi([origin, visible, remote], {
      selectedElementIds: {},
      visibleBounds: [900, 500, 1700, 1200],
    });

    await TOOLS_BY_NAME.add_elements.handler(api, {
      skeletons: [
        { type: "rectangle", x: 100, y: 100, width: 200, height: 100 },
      ],
    });

    expect(updateScene.mock.calls[0][0].elements[3]).toMatchObject({
      x: 1520,
      y: 600,
    });
  });

  it("preserves generated coordinates when they already occupy open space", async () => {
    const { api, updateScene } = makeApi();

    await TOOLS_BY_NAME.add_elements.handler(api, {
      skeletons: [
        { type: "rectangle", x: 700, y: 100, width: 200, height: 100 },
      ],
    });

    expect(updateScene.mock.calls[0][0].elements[1]).toMatchObject({
      x: 700,
      y: 100,
    });
  });
});
