export default function RecordPuzzle({
  src,
  cols = 5,
  rows = 7,
  openCount = 0,
}) {
  const total = cols * rows;

  return (
    <div className="record-puzzle">
      <img className="record-puzzle__img" src={src} alt="창의적 체험활동 상황" />
      <div
        className="record-puzzle__mask"
        style={{ "--cols": cols, "--rows": rows }}
      >
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={
              "record-puzzle__piece" + (i < openCount ? " is-open" : "")
            }
          />
        ))}
      </div>
    </div>
  );
}