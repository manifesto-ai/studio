import { useState } from "react";
import { MelEditor } from "@manifesto-ai/mel-editor";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ScrollArea,
  Tabs,
  TabsList,
  TabsTrigger,
  TreeView,
  type TreeDataItem
} from "@manifesto-ai/ui-core";

import { useStudioState, useStudioDispatch } from "../../context/studio-context.js";
import { useSchemaTree } from "../../hooks/use-studio.js";
import type { SchemaTreeItem } from "../../authoring.js";

function toTreeData(items: SchemaTreeItem[]): TreeDataItem[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    children: item.children ? toTreeData(item.children) : undefined,
    className:
      item.id === "group:state" ||
      item.id === "group:computed" ||
      item.id === "group:actions"
        ? "text-foreground"
        : undefined,
    actions: item.hint ? (
      <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {item.hint}
      </span>
    ) : null
  }));
}

export function CodeSidebar() {
  const state = useStudioState();
  const dispatch = useStudioDispatch();
  const schemaTree = useSchemaTree();
  const [tab, setTab] = useState("code");

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Draft</CardTitle>
          <Tabs onValueChange={setTab} value={tab}>
            <TabsList>
              <TabsTrigger value="code">Code</TabsTrigger>
              <TabsTrigger value="tree">Tree</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 pb-4">
        {tab === "code" ? (
          <div className="h-full overflow-hidden rounded-xl border border-border/70">
            <MelEditor
              value={state.source}
              onChange={(source) => dispatch({ type: "SET_SOURCE", source })}
            />
          </div>
        ) : (
          <ScrollArea className="h-full rounded-2xl border border-border/70 bg-background/20">
            <div className="p-2">
              {schemaTree.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No tree
                </p>
              ) : (
                <TreeView
                  data={toTreeData(schemaTree)}
                  expandAll
                  initialSelectedItemId={state.selectedNodeId}
                  selectedItemId={state.selectedNodeId}
                  onSelectChange={(item) => {
                    if (!item || item.id.startsWith("group:")) {
                      return;
                    }
                    dispatch({ type: "SELECT_NODE", nodeId: item.id });
                    if (item.id.startsWith("action:")) {
                      dispatch({
                        type: "SELECT_ACTION",
                        actionId: item.id.slice("action:".length)
                      });
                    }
                  }}
                  renderItem={({ item, isLeaf, isSelected }) => (
                    <div className="flex min-w-0 items-center gap-3">
                      {!isLeaf ? (
                        <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                          {item.name}
                        </span>
                      ) : (
                        <>
                          <span className="truncate text-sm text-foreground">
                            {item.name}
                          </span>
                          {isSelected ? (
                            <span className="text-[10px] uppercase tracking-[0.18em] text-primary">
                              selected
                            </span>
                          ) : null}
                        </>
                      )}
                    </div>
                  )}
                />
              )}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
