from __future__ import annotations

import pytest

from buzzerminds_backend.app import room_manager


@pytest.fixture(autouse=True)
def _reset_room_manager() -> None:
    """Clear all rooms and rate limiter state between tests.

    This prevents state leaking between tests when they share the
    module-level room_manager singleton.
    """
    room_manager.rooms.clear()
    room_manager.rate_limiter = type(room_manager.rate_limiter)()
