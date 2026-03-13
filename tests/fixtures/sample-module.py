"""Sample Python module for codemode-x adapter testing."""

from typing import List, Optional, Dict


def get_users(limit: int = 10, active: bool = True) -> List[Dict[str, str]]:
    """Fetch a list of users from the database.

    Args:
        limit: Maximum number of users to return
        active: Only return active users
    """
    return [{"id": "1", "name": "Alice", "active": str(active)}][:limit]


def get_user_by_id(user_id: str) -> Dict[str, str]:
    """Look up a single user by their ID.

    :param user_id: The unique user identifier
    """
    return {"id": user_id, "name": "Alice", "email": "alice@example.com"}


def create_user(name: str, email: str, role: Optional[str] = None) -> Dict[str, str]:
    """Create a new user account."""
    return {"id": "new-1", "name": name, "email": email, "role": role or "member"}


def calculate_total(prices: List[float], tax_rate: float = 0.0) -> float:
    """Calculate the total with optional tax."""
    subtotal = sum(prices)
    return subtotal * (1 + tax_rate)


def _internal_helper():
    """This should not be exposed — starts with underscore."""
    pass
