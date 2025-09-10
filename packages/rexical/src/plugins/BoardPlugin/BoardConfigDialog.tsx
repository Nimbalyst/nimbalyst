import React, { useState, useEffect, useContext } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { Dropdown } from 'primereact/dropdown';
import { InputText } from 'primereact/inputtext';
import { Card } from 'primereact/card';
import { Message } from 'primereact/message';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCog, faColumns, faFilter } from '@fortawesome/pro-light-svg-icons';

import {SpaceContext} from "../../App";
import ToastContext from '../../ToastContext';
import {buildIconComponent} from "../../utils/iconUtils";
import { useServerClient } from '../../server/ServerClient';
import {SchemaClassDefinition, SchemaDocument} from "@stravu/shared";

export interface BoardConfig {
  entityTypeId: string;
  entityTypeName: string;
  statusPropertyId: string;
  statusPropertyName: string;
  title?: string;
  filter?: string;
}

interface BoardConfigDialogProps {
  visible: boolean;
  onHide: () => void;
  onSelect: (config: BoardConfig) => void;
  initialConfig?: BoardConfig;
}

interface PropertyOption {
  id: string;
  name: string;
  type: string;
  enumOptions?: Array<{ value: string; label: string; icon?: string; color?: string }>;
}

export function BoardConfigDialog({ visible, onHide, onSelect, initialConfig }: BoardConfigDialogProps) {
  const [loading, setLoading] = useState(false);
  const [entityTypes, setEntityTypes] = useState<SchemaClassDefinition[]>([]);
  const [selectedEntityType, setSelectedEntityType] = useState<SchemaClassDefinition | null>(null);
  const [statusProperties, setStatusProperties] = useState<PropertyOption[]>([]);
  const [selectedStatusProperty, setSelectedStatusProperty] = useState<PropertyOption | null>(null);
  const [boardTitle, setBoardTitle] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { schemaService } = useServerClient();

  const spaceContext = useContext(SpaceContext);
  const { showToast } = useContext(ToastContext);

  useEffect(() => {
    if (visible) {
      loadEntityTypes();

      if (initialConfig) {
        setBoardTitle(initialConfig.title || '');
        setFilter(initialConfig.filter || '');
      } else {
        setBoardTitle('');
        setFilter('');
      }
    }
  }, [visible, initialConfig]);

  useEffect(() => {
    if (selectedEntityType) {
      loadStatusProperties();
    } else {
      setStatusProperties([]);
      setSelectedStatusProperty(null);
    }
  }, [selectedEntityType]);

  const loadEntityTypes = async () => {
    if (!spaceContext) return;

    try {
      setLoading(true);
      setError(null);

      const schema: SchemaDocument = await schemaService.fetchSchemas(spaceContext);

      const types = schema.classes || [];
      setEntityTypes(types);

      if (initialConfig) {
        const existingType = types.find(type => type._id === initialConfig.entityTypeId);
        if (existingType) {
          setSelectedEntityType(existingType);
        }
      }
    } catch (err) {
      console.error('Failed to load entity types:', err);
      setError('Failed to load entity types. Please try again.');
      showToast({ severity: 'error', summary: 'Error', detail: 'Failed to load entity types' });
    } finally {
      setLoading(false);
    }
  };

  const loadStatusProperties = async () => {
    if (!selectedEntityType || !spaceContext) return;

    try {
      const entityClass = await schemaService.fetchEntityClass(spaceContext, selectedEntityType._id);

      if (entityClass && entityClass.properties) {
        const enumProperties = entityClass.properties
          .filter(prop => prop.type === 'ENUM')
          .map(prop => ({
            id: prop.id,
            name: prop.name,
            type: prop.type,
            enumOptions: prop.enumOptions || []
          }));

        setStatusProperties(enumProperties);

        if (initialConfig && initialConfig.statusPropertyId) {
          const existingProperty = enumProperties.find(prop => prop.id === initialConfig.statusPropertyId);
          if (existingProperty) {
            setSelectedStatusProperty(existingProperty);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load status properties:', err);
      setError('Failed to load properties for selected entity type.');
    }
  };

  const handleCreate = () => {
    if (!selectedEntityType || !selectedStatusProperty) {
      setError('Please select both an entity type and a status property.');
      return;
    }

    const config: BoardConfig = {
      entityTypeId: selectedEntityType._id,
      entityTypeName: selectedEntityType.name,
      statusPropertyId: selectedStatusProperty.id,
      statusPropertyName: selectedStatusProperty.name,
      title: boardTitle.trim() || `${selectedEntityType.name} Board`,
      filter: filter.trim() || undefined
    };

    onSelect(config);
    onHide();
    resetForm();
  };

  const resetForm = () => {
    setSelectedEntityType(null);
    setSelectedStatusProperty(null);
    setBoardTitle('');
    setFilter('');
    setError(null);
  };

  const handleCancel = () => {
    onHide();
    resetForm();
  };

  const entityTypeOptions = entityTypes.map(type => ({
    label: type.name,
    value: type,
    icon: type.fontawesomeIcon
  }));

  const statusPropertyOptions = statusProperties.map(prop => ({
    label: prop.name,
    value: prop
  }));

  const entityTypeTemplate = (option: any) => {
    if (!option) return null;

    return (
      <div className="flex align-items-center gap-2">
        {option.icon && buildIconComponent(option.icon)}
        <span>{option.label}</span>
      </div>
    );
  };

  const statusPropertyTemplate = (option: any) => {
    if (!option) return null;

    return (
      <div className="flex align-items-center gap-2">
        <FontAwesomeIcon icon={faColumns} className="text-sm" />
        <span>{option.label}</span>
        {option.value.enumOptions && (
          <span className="text-xs text-500">({option.value.enumOptions.length} options)</span>
        )}
      </div>
    );
  };

  const footerContent = (
    <div className="flex justify-content-between gap-2">
      <Button
        label="Cancel"
        severity="secondary"
        onClick={handleCancel}
        outlined
      />
      <Button
        label={initialConfig ? "Update Board" : "Create Board"}
        severity="primary"
        onClick={handleCreate}
        disabled={!selectedEntityType || !selectedStatusProperty}
        loading={loading}
      />
    </div>
  );

  return (
    <Dialog
      header={
        <div className="flex align-items-center gap-2">
          <FontAwesomeIcon icon={faCog} />
          <span>{initialConfig ? "Configure Board" : "Create New Board"}</span>
        </div>
      }
      visible={visible}
      onHide={handleCancel}
      modal
      style={{ width: '500px' }}
      footer={footerContent}
    >
      <div className="flex flex-column gap-4">
        {error && (
          <Message severity="error" text={error} />
        )}

        <Card title="Entity Configuration" className="p-3">
          <div className="flex flex-column gap-3">
            <div className="field">
              <label htmlFor="entityType" className="font-semibold">
                Entity Type *
              </label>
              <Dropdown
                id="entityType"
                options={entityTypeOptions}
                value={selectedEntityType}
                onChange={(e) => setSelectedEntityType(e.value)}
                placeholder="Select an entity type"
                filter
                showClear
                itemTemplate={entityTypeTemplate}
                valueTemplate={entityTypeTemplate}
                className="w-full"
                disabled={loading}
              />
              <small className="text-500">
                Choose the type of entities to display on this board
              </small>
            </div>

            <div className="field">
              <label htmlFor="statusProperty" className="font-semibold">
                Status Property *
              </label>
              <Dropdown
                id="statusProperty"
                options={statusPropertyOptions}
                value={selectedStatusProperty}
                onChange={(e) => setSelectedStatusProperty(e.value)}
                placeholder="Select a status property"
                showClear
                itemTemplate={statusPropertyTemplate}
                valueTemplate={statusPropertyTemplate}
                className="w-full"
                disabled={!selectedEntityType || loading}
              />
              <small className="text-500">
                Choose the enum property that will define board columns
              </small>
            </div>
          </div>
        </Card>

        <Card title="Board Settings" className="p-3">
          <div className="flex flex-column gap-3">
            <div className="field">
              <label htmlFor="boardTitle" className="font-semibold">
                Board Title
              </label>
              <InputText
                id="boardTitle"
                value={boardTitle}
                onChange={(e) => setBoardTitle(e.target.value)}
                placeholder="Enter board title (optional)"
                className="w-full"
              />
              <small className="text-500">
                Custom title for the board (defaults to "{selectedEntityType?.name} Board")
              </small>
            </div>

            <div className="field">
              <label htmlFor="filter" className="font-semibold">
                <FontAwesomeIcon icon={faFilter} className="mr-1" />
                Filter (Advanced)
              </label>
              <InputText
                id="filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Enter filter expression (optional)"
                className="w-full"
              />
              <small className="text-500">
                Optional filter to limit which entities appear on the board
              </small>
            </div>
          </div>
        </Card>

        {selectedStatusProperty && selectedStatusProperty.enumOptions && (
          <Card title="Board Preview" className="p-3">
            <div className="flex flex-column gap-2">
              <small className="font-semibold">Columns will be created for:</small>
              <div className="flex flex-wrap gap-2">
                {selectedStatusProperty.enumOptions.map((option, index) => (
                  <div key={index} className="flex align-items-center gap-1 p-2 border-round"
                       style={{ backgroundColor: option.color || '#f8f9fa', border: '1px solid #dee2e6' }}>
                    {option.icon && buildIconComponent(option.icon)}
                    <span className="text-sm">{option.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}
      </div>
    </Dialog>
  );
}
