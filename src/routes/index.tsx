import { createFileRoute } from "@tanstack/react-router";
import { SurfTV } from "../components/surf-tv/SurfTV";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Surf TV — Just Flip Channels" },
      { name: "description", content: "A lean-back TV experience. No browse. No grid. Just channels." },
      { property: "og:title", content: "Surf TV" },
      { property: "og:description", content: "A lean-back TV experience. Just flip channels." },
    ],
  }),
  component: SurfTV,
});
