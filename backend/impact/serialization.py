"""Serialisation machinery shared by every collision-engine contract: strict typed frozen dataclasses, canonical
JSON and SHA-256 digests. No physics. The schemas themselves are in contracts.py; configuration in config.py."""
import dataclasses
import hashlib
import json
import math
import re
import types
import typing
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Literal, Optional, Union

SCHEMA_VERSION = 1
UNIT_QUATERNION_TOLERANCE = 1.0e-12
FRACTION_SUM_TOLERANCE = 1.0e-12


class ContractError(ValueError):
    """A contract value is invalid or cannot be parsed. The message names the offending path."""



# ----------------------------------------------------------------------------------------------------------------
# Generic machinery
# ----------------------------------------------------------------------------------------------------------------
def jfield(json_name: str | None = None, **kwargs: Any):
    """A dataclass field whose JSON key differs from the automatic snake_case -> camelCase conversion."""
    metadata = dict(kwargs.pop("metadata", {}))
    if json_name is not None:
        metadata["json"] = json_name
    return field(metadata=metadata, **kwargs)


def _camel(name: str) -> str:
    head, *rest = name.rstrip("_").split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in rest)


def _json_key(f: dataclasses.Field) -> str:
    return f.metadata.get("json") or _camel(f.name)


_HINTS: dict[type, dict[str, Any]] = {}


def _hints(cls: type) -> dict[str, Any]:
    if cls not in _HINTS:
        _HINTS[cls] = typing.get_type_hints(cls)
    return _HINTS[cls]


def _coerce(value: Any, hint: Any, path: str) -> Any:
    """Check `value` against `hint` and return it in canonical form (int -> float, list -> tuple, dict -> Contract)."""
    origin = typing.get_origin(hint)
    if origin in (Union, types.UnionType):
        args = typing.get_args(hint)
        if len(args) == 2 and type(None) in args:
            if value is None:
                return None
            return _coerce(value, args[0] if args[1] is type(None) else args[1], path)
        raise ContractError(f"{path}: unsupported union {hint}")
    if hint is float:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ContractError(f"{path}: expected a number, got {value!r}")
        if not math.isfinite(value):
            raise ContractError(f"{path}: not finite ({value!r})")
        return float(value)
    if hint is int:
        if isinstance(value, bool) or not isinstance(value, int):
            raise ContractError(f"{path}: expected an integer, got {value!r}")
        return value
    if hint is bool:
        if not isinstance(value, bool):
            raise ContractError(f"{path}: expected a boolean, got {value!r}")
        return value
    if hint is str:
        if not isinstance(value, str):
            raise ContractError(f"{path}: expected a string, got {value!r}")
        return value
    if origin is Literal:
        if value not in typing.get_args(hint) or isinstance(value, bool):
            raise ContractError(f"{path}: {value!r} is not one of {list(typing.get_args(hint))}")
        return value
    if isinstance(hint, type) and issubclass(hint, Enum):
        try:
            return hint(value)
        except ValueError:
            raise ContractError(f"{path}: {value!r} is not a valid {hint.__name__}") from None
    if origin is tuple:
        args = typing.get_args(hint)
        if not isinstance(value, (list, tuple)):
            raise ContractError(f"{path}: expected a list, got {value!r}")
        if len(args) == 2 and args[1] is Ellipsis:
            return tuple(_coerce(v, args[0], f"{path}[{i}]") for i, v in enumerate(value))
        if len(value) != len(args):
            raise ContractError(f"{path}: expected {len(args)} items, got {len(value)}")
        return tuple(_coerce(v, a, f"{path}[{i}]") for i, (v, a) in enumerate(zip(value, args)))
    if origin is dict:
        key_t, val_t = typing.get_args(hint)
        if not isinstance(value, dict):
            raise ContractError(f"{path}: expected an object, got {value!r}")
        return {_coerce(k, key_t, f"{path}.<key>"): _coerce(v, val_t, f"{path}.{k}") for k, v in value.items()}
    if isinstance(hint, type) and issubclass(hint, Contract):
        if isinstance(value, hint):
            return value
        if isinstance(value, dict):
            return hint.from_dict(value, path)
        raise ContractError(f"{path}: expected {hint.__name__}, got {value!r}")
    raise ContractError(f"{path}: unsupported type {hint}")


def _encode(value: Any) -> Any:
    if isinstance(value, Contract):
        return value.to_dict()
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (tuple, list)):
        return [_encode(v) for v in value]
    if isinstance(value, dict):
        return {k: _encode(v) for k, v in value.items()}
    return value


def canonical_json(data: Any) -> str:
    """Canonical JSON text: sorted keys, no whitespace, ASCII, no NaN/Infinity. Accepts a Contract or plain data."""
    if isinstance(data, Contract):
        data = data.to_dict()
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def canonical_digest(data: Any) -> str:
    """SHA-256 (lower-case hex) of the canonical JSON text of `data` (UTF-8)."""
    return hashlib.sha256(canonical_json(data).encode("utf-8")).hexdigest()


_DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True)
class Contract:
    """Base of every contract. Subclasses declare fields and override `_validate` for semantic rules."""

    def __post_init__(self) -> None:
        hints = _hints(type(self))
        for f in dataclasses.fields(self):
            object.__setattr__(self, f.name, _coerce(getattr(self, f.name), hints[f.name], f"{type(self).__name__}.{f.name}"))
        if "schema_version" in {f.name for f in dataclasses.fields(self)} and self.schema_version != SCHEMA_VERSION:  # type: ignore[attr-defined]
            raise ContractError(f"{type(self).__name__}.schema_version: unsupported version {self.schema_version!r}")  # type: ignore[attr-defined]
        self._validate()

    def _validate(self) -> None:
        """Semantic checks beyond the type check. Raise ContractError."""

    # -- serialisation ---------------------------------------------------------------------------------------
    def to_dict(self) -> dict[str, Any]:
        return {_json_key(f): _encode(getattr(self, f.name)) for f in dataclasses.fields(self)}

    def to_json(self) -> str:
        return canonical_json(self.to_dict())

    def digest(self) -> str:
        return canonical_digest(self.to_dict())

    @classmethod
    def from_dict(cls, data: dict[str, Any], path: str | None = None):
        path = path or cls.__name__
        if not isinstance(data, dict):
            raise ContractError(f"{path}: expected an object, got {data!r}")
        fields = {_json_key(f): f for f in dataclasses.fields(cls)}
        unknown = sorted(set(data) - set(fields))
        if unknown:
            raise ContractError(f"{path}: unknown field(s) {unknown}")
        kwargs = {}
        for key, f in fields.items():
            if key in data:
                kwargs[f.name] = data[key]
            elif f.default is dataclasses.MISSING and f.default_factory is dataclasses.MISSING:
                raise ContractError(f"{path}.{key}: missing required field")
        return cls(**kwargs)

    @classmethod
    def from_json(cls, text: str):
        try:
            data = json.loads(text, parse_constant=_reject_constant)
        except json.JSONDecodeError as exc:
            raise ContractError(f"{cls.__name__}: invalid JSON ({exc})") from None
        return cls.from_dict(data)


def _reject_constant(name: str) -> Any:
    raise ContractError(f"JSON constant {name} is not allowed")


# -- validation helpers --------------------------------------------------------------------------------------------
def _positive(owner: str, **values: float | None) -> None:
    for name, value in values.items():
        if value is not None and not value > 0.0:
            raise ContractError(f"{owner}.{name}: must be > 0, got {value!r}")


def _non_negative(owner: str, **values: float | None) -> None:
    for name, value in values.items():
        if value is not None and not value >= 0.0:
            raise ContractError(f"{owner}.{name}: must be >= 0, got {value!r}")


def _fraction(owner: str, **values: float | None) -> None:
    for name, value in values.items():
        if value is not None and not 0.0 <= value <= 1.0:
            raise ContractError(f"{owner}.{name}: must be within [0, 1], got {value!r}")


def _unit_quaternion(owner: str, q: tuple[float, float, float, float]) -> None:
    norm = math.sqrt(sum(c * c for c in q))
    if abs(norm - 1.0) > UNIT_QUATERNION_TOLERANCE:
        raise ContractError(f"{owner}: quaternion must have unit norm (1 +/- {UNIT_QUATERNION_TOLERANCE}), got {norm!r}")


def _fractions_sum_to_one(owner: str, fractions: list[float]) -> None:
    total = math.fsum(fractions)
    if abs(total - 1.0) > FRACTION_SUM_TOLERANCE:
        raise ContractError(f"{owner}: mass fractions must sum to 1 (+/- {FRACTION_SUM_TOLERANCE}), got {total!r}")


def _digest_or_empty(owner: str, value: str) -> None:
    if value and not _DIGEST_RE.match(value):
        raise ContractError(f"{owner}: must be empty or 64 lower-case hex characters, got {value!r}")


