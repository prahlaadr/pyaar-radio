import { useRef, useState, useLayoutEffect } from "react";
import type { Artist } from "@/lib/types";
import { useVirtualizer } from "@tanstack/react-virtual";

interface Props {
  artists: Artist[];
  onSelect: (artist: Artist) => void;
  /** If provided, the virtualizer uses this element as its scroll container
   *  instead of ArtistList's own div. Lets the parent (e.g. Browse view) scroll
   *  Discover + ArtistList together as one continuous scroll. */
  scrollElementRef?: React.RefObject<HTMLDivElement | null>;
}

export function ArtistList({ artists, onSelect, scrollElementRef }: Props) {
  const internalScrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const useExternalScroll = !!scrollElementRef;

  // When using an external scroll container (e.g. Browse view's parent scrolls
  // Discover + ArtistList together), the virtualizer's items are below the
  // header content. Track the offset of our items container from the scroll
  // container top and pass it as scrollMargin so items render at correct
  // visual positions.
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    if (!useExternalScroll) return;
    const update = () => {
      const inner = innerRef.current;
      const scroll = scrollElementRef?.current;
      if (!inner || !scroll) return;
      const innerTop = inner.getBoundingClientRect().top;
      const scrollTop = scroll.getBoundingClientRect().top;
      setScrollMargin(innerTop - scrollTop + scroll.scrollTop);
    };
    update();
    const ro = new ResizeObserver(update);
    if (scrollElementRef?.current) ro.observe(scrollElementRef.current);
    if (innerRef.current) ro.observe(innerRef.current);
    return () => ro.disconnect();
  }, [useExternalScroll, scrollElementRef, artists.length]);

  const virtualizer = useVirtualizer({
    count: artists.length,
    getScrollElement: () => (useExternalScroll ? scrollElementRef!.current : internalScrollRef.current),
    estimateSize: () => 56,
    overscan: 10,
    scrollMargin: useExternalScroll ? scrollMargin : 0,
  });

  if (artists.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[#999] text-xs uppercase tracking-widest">No results</p>
      </div>
    );
  }

  // When external scroll is provided, render flat (no overflow-y-auto wrapper)
  // so we participate in the parent's scroll flow.
  const outerProps = useExternalScroll
    ? { className: "" }
    : { ref: internalScrollRef, className: "flex-1 overflow-y-auto min-h-0" };

  return (
    <div {...outerProps}>
      <div ref={innerRef} style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative", width: "100%" }}>
        {virtualizer.getVirtualItems().map((vr) => {
          const artist = artists[vr.index];
          if (!artist) return null;
          return (
            <button
              key={artist.artist}
              data-index={vr.index}
              ref={virtualizer.measureElement}
              onClick={() => onSelect(artist)}
              className="w-full text-left px-5 py-2.5 hover:bg-[#111] border-b border-[#151515] transition-colors group absolute left-0 right-0 top-0"
              style={{ transform: `translateY(${vr.start - (useExternalScroll ? scrollMargin : 0)}px)` }}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium group-hover:text-red-500 transition-colors">
                  {artist.artist}
                </span>
                <span className="text-[10px] text-[#999] uppercase tracking-wider">
                  {artist.channel}
                </span>
                {artist.desi === "Desi" && (
                  <span className="text-[10px] text-red-600 uppercase tracking-wider">
                    Desi
                  </span>
                )}
                <span className="text-[10px] text-[#999] ml-auto tabular-nums">
                  {artist.bpmLow}&ndash;{artist.bpmHigh}
                </span>
              </div>
              <div className="flex gap-2 mt-0.5">
                {artist.vibes.map((v) => (
                  <span key={v} className="text-[10px] text-[#999]">
                    {v}
                  </span>
                ))}
                <span className="text-[10px] text-[#999]">&middot;</span>
                <span className="text-[10px] text-[#999]">{artist.samay}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
