from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime

from app.api.schemas import CapacitySegment


def capacity_segments(
    capacity: int,
    starts_at: datetime,
    ends_at: datetime,
    reservations: Iterable[tuple[datetime, datetime, int]],
) -> list[CapacitySegment]:
    changes: dict[datetime, int] = defaultdict(int)
    changes[starts_at] = 0
    changes[ends_at] = 0
    for start, end, courts in reservations:
        left, right = max(start, starts_at), min(end, ends_at)
        if left < right:
            changes[left] += courts
            changes[right] -= courts
    points = sorted(changes)
    occupied = 0
    result: list[CapacitySegment] = []
    for left, right in zip(points, points[1:], strict=False):
        occupied += changes[left]
        segment = CapacitySegment(
            starts_at=left,
            ends_at=right,
            occupied=occupied,
            available=max(0, capacity - occupied),
            excess=max(0, occupied - capacity),
        )
        if result and result[-1].occupied == occupied:
            result[-1].ends_at = right
        else:
            result.append(segment)
    return result
