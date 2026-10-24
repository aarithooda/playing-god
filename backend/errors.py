"""Coded errors for the universe/lab API (plan section 12.1). Existing error shapes stay `{"detail": ...}`; these add
`"code"` so a client can branch on the cause without parsing prose."""


class CodedError(Exception):
    status = 409
    code = "conflict"

    def __init__(self, detail: str, *, code: str | None = None, status: int | None = None):
        super().__init__(detail)
        self.detail = detail
        if code is not None:
            self.code = code
        if status is not None:
            self.status = status


class StepCancelled(CodedError):
    """The universe was deactivated (or its activation epoch changed) while a mutation was running; the mutation was
    rolled back and nothing was committed."""

    status = 409
    code = "deactivated_during_step"

    def __init__(self, detail: str = "the universe was deactivated during the operation; nothing was changed"):
        super().__init__(detail)


def universe_not_found(universe_id: str, deleted: bool = False) -> CodedError:
    detail = f"universe {universe_id} was deleted" if deleted else f"unknown universe: {universe_id}"
    return CodedError(detail, code="universe_not_found", status=404)
