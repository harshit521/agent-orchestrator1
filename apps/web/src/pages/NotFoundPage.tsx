import { hrefFor } from "../lib/router";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/States";

export function NotFoundPage() {
  return (
    <div>
      <PageHeader
        title="Page not found"
        description="The route you requested does not exist in this build."
      />
      <EmptyState
        title="Nothing here"
        description="Check the URL or return to the overview to continue working with tasks and runs."
        action={
          <a href={hrefFor("/")}>
            <Button
              size="sm"
              variant="primary"
              leading={<Icon name="arrowLeft" className="h-3.5 w-3.5" />}
            >
              Back to overview
            </Button>
          </a>
        }
      />
    </div>
  );
}
