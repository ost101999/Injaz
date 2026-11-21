// Candidate child panels must fit on screen without covering an open panel.
export function availableMenuSide(parent, width, visiblePanels, viewportWidth, margin = 10, gap = 5) {
    const fits = x => x >= margin - 0.5 && x + width <= viewportWidth - margin + 0.5 &&
        visiblePanels.every(rect => x + width <= rect.left + 0.5 || x >= rect.right - 0.5);
    const left = parent.left - width - gap;
    const right = parent.right + gap;
    return fits(left) ? left : fits(right) ? right : null;
}
